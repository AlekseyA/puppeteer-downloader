const moment = require('moment');
const crypto = require('crypto');
const fs = require('fs');
const puppeteer = require('puppeteer');
const rp = require('request-promise');
const { config } = require('../configs');
const selectors = require('../configs/selectors');

const controller = async (req, res) => {
    let params = {
        id: req.body.id,
        created_date: req.body.created_date,
        answer1: req.body.answer1,
        answer2: req.body.answer2
    }
    params = validateParams(params, res);
    try {
        const result = await getFile(params);
        if (result.error) {
            return res.status(400).json({ message: result.message });
        }
        return sendFile(res, result.path)
    } catch (err) {
        return res.status(500).json({ error: true, message: `Puppeteer error: ${err.message}` })
    }    
};

const sendFile = (res, filePath) => {
    return res.send('File successfully downloaded');
}

/**
 * Validate body params. Return error(400) if params are invalid
 */
const validateParams = (params, res) => {
    const invalidParams = [];
    if (!params.id) {
        invalidParams.push('ID')
    }
    if (!params.created_date) {
        invalidParams.push('DATE OF CREATE ID')
    } else {
        const formatedDate = moment(params.created_date, 'MM/DD/YYYY').format('M/D/YYYY')
        const [day, month, year] = formatedDate.split('/');
        params.created_date = {
            day,
            month,
            year
        }
    }

    if (!params.answer1) {
        invalidParams.push('Passport anwser')
    }
    if (!params.answer2) {
        invalidParams.push('Departure anwser')
    }
    if (invalidParams.length) {
        const missingParams = invalidParams.join(', ');
        return res.status(400).json({ error: true, message: `Next params are missing: ${missingParams}` });
    }
    return params;
}

const solveCaptcha = async (page) => {
    const captchaImageBase64 = await page.evaluate((selectors) => {
        const canvas = document.createElement("canvas");
        const img = document.getElementById(selectors.CAPTCHA_IMAGE);
        canvas.width = img.width;
        canvas.height = img.height;

        // Copy the image contents to the canvas
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // Get the data-URL formatted image
        const dataURL = canvas.toDataURL("image/png");

        return dataURL //.replace(/^data:image\/(png|jpg);base64,/, "");
    }, selectors)
    // console.log('cib64', captchaImageBase64);
    const options = {
        method: 'POST',
        uri: config.captcha_solver_request_url,
        body: {
            key: config.API_KEY,
            method: 'base64',
            body: captchaImageBase64,
            json: 1
        },
        json: true // Automatically stringifies the body to JSON
    };
    const captchaCode = await rp(options);
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
    const attempt = 1;
    const captchaResolvedText = await getCaptchaResult(optionsResult, attempt);
    console.log('fuck yeah!', captchaResolvedText);
    return captchaResolvedText;
}

const getCaptchaResult = (options, attempt) => {
    console.log(`Trying get captcha result. Attempt ${attempt++}`);
    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            const result = await rp(options);
            if (result.status === 1) {
                resolve(result.request);
            } else {
                resolve(getCaptchaResult(options, attempt))
            }
        }, 4000)
    })
}

const getFile = async (inputData) => {
    const browser = await puppeteer.launch({ headless: false, args: [], defaultViewport: { width: 1024, height: 1000 } }); // '--no-sandbox'
    const page = await browser.newPage();
    const hash = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(`./files/${hash}`)
    await page._client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: `./files/${hash}`
    });
    await page.goto(config.base_url, { timeout: 100000 });
    await page.click(selectors.OPEN_FORM_BUTTON);
    await page.waitForSelector(selectors.ID_FIELD, { timeout: 20000 });

    // type ID
    await page.type(selectors.ID_FIELD, inputData.id)

    // check passport radio button
    if (inputData.answer1.toLowerCase() === 'yes') {
        await page.click(selectors.PASSPORT_SWITCH_YES);
    } else {
        await page.click(selectors.PASSPORT_SWITCH_NO);
    }

    // check country radio button
    if (inputData.answer1.toLowerCase() === 'yes') {
        await page.click(selectors.COUNTRY_OUT_SWITCH_YES);
    } else {
        await page.click(selectors.COUNTRY_OUT_SWITCH_NO);
    }

    // check terms agree
    await page.click(selectors.TERMS_AGREE);

    // choose day
    console.log('choose day')
    await page.click(selectors.DAY_DROPDOWN)
    const dayItemSelector = selectors.DAT_ITEM.replace('ITEM_ID', inputData.created_date.day)
    await page.waitForSelector(dayItemSelector, { timeout: 5000 });
    await page.click(dayItemSelector)

    // choose month
    console.log('choose month')
    await page.click(selectors.MONTH_DROPDOWN)
    const monthItemSelector = selectors.MONTH_ITEM.replace('ITEM_ID', inputData.created_date.month)
    await page.waitForSelector(monthItemSelector, { timeout: 5000 });
    await page.click(monthItemSelector)

    // choose year
    console.log('choose year')
    await page.click(selectors.YEAR_DROPDOWN)
    // calculate option index in year dropdown
    const yearOptionIndex = 2019 - inputData.created_date.year;
    const yearItemSelector = selectors.YEAR_ITEM.replace('ITEM_ID', yearOptionIndex)
    await page.waitForSelector(yearItemSelector, { timeout: 5000 });
    await page.click(yearItemSelector)

    // solve captcha
    console.log('start captcha')
    const captchaDigit = await solveCaptcha(page);
    // type solved captcha to input
    console.log('type captcha')
    await page.type(selectors.CAPTCHA_CODE, captchaDigit);
    // go to next page
    console.log('go next')
    try {
        await page.click(selectors.BUTTON_NEXT);
        await page.waitForSelector(selectors.MODAL_ERROR_BODY, { timeout: 8000 });
        await page.waitFor(1000);
        const errorText = await page.$eval(selectors.MODAL_ERROR_BODY, (el) => {
            debugger
            return el.textContent
        });
        return { error: true, message: errorText };
    } catch (err) {
        console.log('There is no error modal');
    }
    // go to download file page
    console.log('here1');
    await page.waitForSelector(selectors.BUTTON_TO_DOWNLOAD_PAGE, { timeout: 5000 });
    console.log('here2');
    await page.click(selectors.BUTTON_TO_DOWNLOAD_PAGE);

    console.log('here3');
    // donwload xls file
    await page.waitForSelector(selectors.DOWNLOAD_XLS_FILE, { timeout: 5000 });
    await page.$eval(selectors.DOWNLOAD_XLS_FILE, e => e.setAttribute('target', '_self'));
    await page.click(selectors.DOWNLOAD_XLS_FILE);
    console.log('here4');
    return {
        error: false,
        path: hash
    }
};

module.exports = {
    controller
}
