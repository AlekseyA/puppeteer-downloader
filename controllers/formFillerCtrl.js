const path = require('path');
const moment = require('moment');
const crypto = require('crypto');
const fs = require('fs');
const puppeteer = require('puppeteer');
const rp = require('request-promise');
const { config } = require('../configs');
const selectors = require('../configs/selectors');

/**
 * Handle POST request with the following params:
 * @param {*} req - Request object 
 * @param {*} res - Response Object
 * req.body
 * - id: {integer/string}
 * - created_date: DATE OF CREATE ID. Format: 'YYYY-MM-DD' {String}
 * - passport_answer: 'yes/no' {String}
 * - country_answer: 'yes/no' {String}
 */
const controller = async (req, res) => {
    const params = {
        id: req.body.id,
        created_date: req.body.created_date,
        passportAnswer: req.body.passport_answer,
        countryAnswer: req.body.country_answer
    }

    // validate incoming params
    const invalidParams = validateParams(params);
    if (invalidParams.length) {
        const missingParams = invalidParams.join(', ');
        return res.status(400).json({ error: true, message: `Next params are invalid: ${missingParams}` });
    }

    // init scrapper
    const scrapper = new Scrapper()
    try {
        const fileResult = await scrapper.getFile(params);

        if (fileResult.error) {
            return res.status(400).json({ message: fileResult.message, id: fileResult.id });
        }

        // send file to another API
        const listDir = await getFiles(fileResult.path)
        const sendResult = await sendFile(listDir, fileResult.path, fileResult.id);
        return res.json(sendResult)
    } catch (err) {
        // handle all errors
        console.log(`Error: ${err.message}`);
        return res.status(400).json({ error: true, message: `Error: ${err.message}` })
    } finally {
        // close browser instance
        await scrapper.killBrowserInstance();
    }
};

const sendFile = (files, folderPath, id) => {
    console.log('folder path', folderPath);
    return new Promise(async (resolve, reject) => {
        const file = files[0];
        try {
            if (file.indexOf('.crdownload') > -1) {
                await waitForDownloadFile(`./files/${folderPath}/${file}`)
            }
            const fileStream = fs.readFileSync(`./files/${folderPath}/${file.replace('.crdownload', '')}`);
            const base64file = new Buffer(fileStream).toString('base64');
            const options = {
                method: 'POST',
                uri: config.target_url,
                body: {
                    id_number: id,
                    file_data: base64file,
                    file_name: file.replace('.crdownload', '')
                },
                headers: {
                    'content-type': 'application/json'
                },
                json: true
            }
            const result = await rp(options);
            resolve(result)
        } catch (err) {
            reject(err)
        }
    })
}

/**
 * 
 * @param {String} folderPath - Path to file
 */
const getFiles = (folderPath) => new Promise((resolve, reject) => {
    try {
        const files = fs.readdirSync(`./files/${folderPath}`)
        if (files.length) {
            resolve(files);
        } else {
            setTimeout(() => {
                resolve(getFiles(folderPath));
            }, 1000)
        }
    } catch (err) {
        reject(err)
    }
})

/**
 * Check finish downloading: downloaded file (filePath) has '.crdownload' in name.
 * When file is downloaded, chrome renames it and removes this postfix.
 * It leads to filePath doesn't exists
 * @param {String} filePath - path to file
 */
const waitForDownloadFile = (filePath) => new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) {
        setTimeout(() => {
            return resolve(waitForDownloadFile(filePath))
        }, 2000)
    } else {
        resolve()
    }
})

/**
 * Validate body params. Return error(400) if params are invalid
 */
const validateParams = (params) => {
    const invalidParams = [];
    if (!params.id) {
        invalidParams.push('ID')
    }
    if (!params.created_date) {
        invalidParams.push('Date of create ID')
    } else {
        try {
            const formatedDate = moment(params.created_date, 'YYYY-MM-DD').format('D/M/YYYY')
            // const formatedDate = moment(params.created_date, 'YYYY-DD-MM').format('M/D/YYYY')
            const [day, month, year] = formatedDate.split('/');
            params.created_date = {
                day,
                month,
                year
            }
        } catch (err) {
            invalidParams.push('Date of create ID')
        }
    }

    if (!params.passportAnswer) {
        invalidParams.push('Passport anwser')
    }
    if (!params.countryAnswer) {
        invalidParams.push('Country anwser')
    }

    return invalidParams;
}


class Scrapper {
    constructor() {
        this.browser = null;
    }

    async getFile(inputData) {
        this.browser = await puppeteer.launch({ headless: true, args: [] }); // '--no-sandbox'
        // this.browser = await puppeteer.launch({ headless: false, args: [], devtools: true, defaultViewport: { width: 2024, height: 1000 } }); // '--no-sandbox'
        const page = await this.browser.newPage();

        // configure pupperteer instance download behavior
        const hash = crypto.randomBytes(16).toString('hex');
        const downloadPath = path.resolve(`${process.cwd()}/files/${hash}`)
        await page._client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath
        });

        // open start url
        await page.goto(config.base_url, { timeout: 100000 });

        // open form
        await page.click(selectors.OPEN_FORM_BUTTON);
        // await page.bringToFront();
        await page.waitForSelector(selectors.ID_FIELD, { timeout: 20000 });

        // ****** FILL FORM *******
        // type ID
        console.log('type id');
        await this.typeId(selectors.ID_FIELD, inputData.id, page)

        // check passport radio button
        console.log('select answers');
        if (inputData.passportAnswer.toLowerCase() === 'yes') {
            await page.click(selectors.PASSPORT_SWITCH_YES);
        } else {
            await page.click(selectors.PASSPORT_SWITCH_NO);
        }

        // check country radio button
        if (inputData.countryAnswer.toLowerCase() === 'yes') {
            await page.click(selectors.COUNTRY_OUT_SWITCH_YES);
        } else {
            await page.click(selectors.COUNTRY_OUT_SWITCH_NO);
        }

        // check terms agree
        await page.click(selectors.TERMS_AGREE);
        
        // choose day
        console.log('choose day')
        const dayItemSelector = selectors.DAT_ITEM.replace('ITEM_ID', inputData.created_date.day)
        await this.chooseDay(page, dayItemSelector);

        // choose month
        console.log('choose month')
        const monthItemSelector = selectors.MONTH_ITEM.replace('ITEM_ID', inputData.created_date.month)
        await this.chooseMonth(page, monthItemSelector)

        // choose year
        console.log('choose year')
        // calculate option index for year dropdown
        const yearOptionIndex = 2019 - inputData.created_date.year;
        const yearItemSelector = selectors.YEAR_ITEM.replace('ITEM_ID', yearOptionIndex)
        await this.chooseYear(page, yearItemSelector);

        // solve captcha
        console.log('start solving captcha...')
        const captchaDigit = await this.solveCaptcha(page);

        console.log('captcha solved. enter it');
        // type solved captcha to input
        await page.type(selectors.CAPTCHA_CODE, captchaDigit);

        // ****** FORM IS FILLED ******


        // go to next page
        console.log('open next page')

        /**
         * Trying to go to the next screen.
         * If modal opens the program execution stops.
         * Otherwise go to download page
         */
        try {
            await page.click(selectors.BUTTON_NEXT);
            // await page.waitFor(2000);
            await page.waitForSelector(selectors.MODAL_ERROR_BODY, { timeout: 8000 });
            const errorText = await page.$eval(selectors.MODAL_ERROR_BODY, el => el.textContent);
            return { error: true, message: errorText, id: inputData.id };
        } catch (err) {
            console.log('There is no error modal');
        }

        // go to download file page
        console.log('Go to download page');
        await page.waitForSelector(selectors.BUTTON_TO_DOWNLOAD_PAGE, { timeout: 5000 });
        await page.click(selectors.BUTTON_TO_DOWNLOAD_PAGE);

        console.log('download xls file');
        // create download folder
        fs.mkdirSync(`./files/${hash}`)
        // download xls file
        await page.waitForSelector(selectors.DOWNLOAD_XLS_FILE, { timeout: 5000 });
        // change target attribute. It is needed to download file on the same page
        await page.$eval(selectors.DOWNLOAD_XLS_FILE, e => e.setAttribute('target', '_self'));
        await page.click(selectors.DOWNLOAD_XLS_FILE);
        return {
            error: false,
            path: hash
        }
    }

    /**
     * Try choose day 5 times. Otherwise throws exception
     * @param {*} page - browser page
     * @param {string} selector - element what should be clicked
     * @param {*} attempt - current attempt. Default 1
     */
    async chooseDay(page, selector, attempt = 1) {
        try {
            await page.click(selectors.DAY_DROPDOWN)
            await page.waitForSelector(selector, { timeout: 5000 });
            await page.click(selector)
        } catch (err) {
            if (attempt <= config.attempt_numbers) {
                console.log('try choosing day one more time...');
                return this.chooseDay(page, selector, ++attempt);
            }
            throw err
        }
    }

    /**
     * Try choose month 5 times. Otherwise throws exception
     * @param {*} page - browser page
     * @param {string} selector - element what should be clicked
     * @param {*} attempt - current attempt. Default 1
     */
    async chooseMonth(page, selector, attempt = 1) {
        try {
            await page.click(selectors.MONTH_DROPDOWN)
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            await page.click(selector)
        } catch (err) {
            if (attempt <= config.attempt_numbers) {
                console.log('try choosing month one more time...');
                return this.chooseMonth(page, selector, ++attempt)
            }
            throw err
        }
    }

    /**
     * Try choose year 5 times. Otherwise throws exception
     * @param {*} page - browser page
     * @param {string} selector - element what should be clicked
     * @param {*} attempt - current attempt. Default 1
     */
    async chooseYear(page, selector, attempt = 1) {
        try {
            await page.click(selectors.YEAR_DROPDOWN)
            await page.waitForSelector(selector, { visible: true, timeout: 5000 });
            await page.click(selector)
        } catch (err) {
            if (attempt <= config.attempt_numbers) {
                console.log('try choosing year one more time...');
                return this.chooseYear(page, selector, ++attempt)
            }
            throw err
        }
    }

    async killBrowserInstance() {
        console.log('close browser');
        await this.browser.close();
    }

    async typeId(selector, dataId, page) {
        await page.type(selector, dataId)
        const idValue = await page.$eval(selector, el => el.value);
        if (idValue.length != dataId.length) {
            console.log('-- invalid id entered');
            return this.typeId(selector, dataId, page)
        }
    }

    /**
     * 
     * @param {Broser page} page
     */
    async solveCaptcha(page) {
        // get captcha image and convert it to base64 format
        const captchaImageBase64 = await page.evaluate((selectors) => {
            const canvas = document.createElement("canvas");
            const img = document.getElementById(selectors.CAPTCHA_IMAGE);
            canvas.width = img.width;
            canvas.height = img.height;

            // Copy the image contents to the canvas
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);

            // Get the data-URL formatted image
            const imageBase64 = canvas.toDataURL("image/png");

            return imageBase64
        }, selectors)

        // prepare 2captcha solve options 
        const options = {
            method: 'POST',
            uri: config.captcha_solver_request_url,
            body: {
                key: config.API_KEY,
                method: 'base64',
                body: captchaImageBase64,
                json: 1
            },
            json: true
        };
        // request returns request_id, what is needed to get captcha's solution 
        const captchaCode = await rp(options);

        console.log('captcha id', captchaCode.request);

        // prepare request options to get solution
        const optionsResult = {
            method: 'GET',
            uri: config.captcha_solver_result_url,
            qs: {
                key: config.API_KEY,
                action: 'GET',
                id: captchaCode.request,
                json: 1
            },
            json: true
        }
        // get solution attempt counter
        const attempt = 1;
        const captchaResolvedText = await this.getCaptchaResult(optionsResult, attempt);
        return captchaResolvedText;
    }

    /**
     * Get captcha solution.
     * If solution is not ready (result.status != 1), wait 4 seconds and try again recursively
     * @param {*} options - request options
     * @param {*} attempt - current attempt
     */
    async getCaptchaResult(options, attempt) {
        console.log(`Trying get captcha result. Attempt ${attempt++}`);
        return new Promise((resolve, reject) => {
            if (attempt > config.attempt_numbers) {
                return reject('Can\'t get captcha result');
            }
            setTimeout(async () => {
                const result = await rp(options);
                if (result.status === 1) {
                    resolve(result.request);
                } else {
                    resolve(this.getCaptchaResult(options, attempt))
                }
            }, 4000)
        })
    }
}



module.exports = {
    controller,
}
