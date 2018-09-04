File downloader with captcha solver. Based on puppeteer
==========

Installation
-----------

Install dependencies:
```bash
npm install
```

Add `local.config.js` to `configs` folder. It has to have the following structure:
```js
module.exports = {
    base_url: 'https://harb.cma.gov.il/',
    API_KEY: 'your_api_key',
    captcha_solver_result_url: 'http://2captcha.com/res.php',
    captcha_solver_request_url: 'http://2captcha.com/in.php',
    target_url: 'http://localhost:3000/api/'
};
```

Using
-----------

Run server:
```bash
npm start
```

Make POST request to `localhost:3000` with body:
```
{
    id: 123123,
    created_date: 'YYYY-MM-DD',
    passport_answer: 'yes/no',
    country_answer: 'yes/no'
}
```