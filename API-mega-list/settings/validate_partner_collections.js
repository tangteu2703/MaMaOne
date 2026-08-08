/**
 * Validate sponsored partner collection counts, deep links, and main README placement.
 *
 * Usage:
 *   node settings/validate_partner_collections.js
 *   node settings/validate_partner_collections.js --check-links
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainReadme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const featuredLanding = fs.readFileSync(path.join(root, '00-featured-apis', 'README.md'), 'utf8');
const apyhubReadme = fs.readFileSync(path.join(root, '00-featured-apis', 'apyhub-utility-apis', 'README.md'), 'utf8');
const coreclawReadme = fs.readFileSync(path.join(root, '00-featured-apis', 'coreclaw-scraper-apis', 'README.md'), 'utf8');
const readmeGenerator = fs.readFileSync(path.join(__dirname, 'generate_readme_clean.js'), 'utf8');

const errors = [];

function check(condition, message) {
    if (!condition) errors.push(message);
}

function unique(values) {
    return new Set(values).size === values.length;
}

const apyhubUrls = [...apyhubReadme.matchAll(/^\| \[[^\]]+\]\((https:\/\/apyhub\.com\/[^)]+)\)/gm)]
    .map(match => match[1]);
const uniqueApyhubUrls = [...new Set(apyhubUrls)];

const coreclawRows = [...coreclawReadme.matchAll(/^- \[[^\]]+\]\((https:\/\/www\.coreclaw\.com\/[^)]+)\)/gm)];
const coreclawUrls = coreclawRows.map(match => match[1]);
const categoryCounts = [...coreclawReadme.matchAll(/^### .+ \((\d+)\)$/gm)]
    .map(match => Number(match[1]));

check(uniqueApyhubUrls.length === 200, `Expected 200 unique ApyHub API links, found ${uniqueApyhubUrls.length}`);
check(coreclawUrls.length === 118, `Expected 118 CoreClaw scraper API links, found ${coreclawUrls.length}`);
check(unique(coreclawUrls), 'CoreClaw collection contains duplicate scraper API links');
check(coreclawUrls.every(url => url.endsWith('?fpr=chris69')), 'Every CoreClaw scraper API must use ?fpr=chris69');
check(categoryCounts.length === 16, `Expected 16 CoreClaw categories, found ${categoryCounts.length}`);
check(categoryCounts.reduce((sum, count) => sum + count, 0) === 118, 'CoreClaw category counts must add up to 118');
check(!coreclawReadme.includes('tokens truncated'), 'CoreClaw collection contains a truncation marker');
check(mainReadme.includes('href="./00-featured-apis/apyhub-utility-apis/"'), 'Main README is missing the ApyHub collection');
check(mainReadme.includes('href="./00-featured-apis/coreclaw-scraper-apis/"'), 'Main README is missing the CoreClaw collection');
check(mainReadme.includes('./assets/featured/apyhub-banner.png'), 'Main README is missing the ApyHub banner');
check(mainReadme.includes('./assets/featured/coreclaw-banner.png'), 'Main README is missing the CoreClaw banner');
check(featuredLanding.includes('href="./apyhub-utility-apis/"'), 'Featured APIs page is missing the ApyHub collection');
check(featuredLanding.includes('href="./coreclaw-scraper-apis/"'), 'Featured APIs page is missing the CoreClaw collection');
check(featuredLanding.includes('../assets/featured/apyhub-banner.png'), 'Featured APIs page is missing the ApyHub banner');
check(featuredLanding.includes('../assets/featured/coreclaw-banner.png'), 'Featured APIs page is missing the CoreClaw banner');
check(apyhubReadme.includes('../../assets/featured/apyhub-banner.png'), 'ApyHub page is missing its featured banner');
check(coreclawReadme.includes('../../assets/featured/coreclaw-banner.png'), 'CoreClaw page is missing its featured banner');
check(fs.existsSync(path.join(root, 'assets', 'featured', 'apyhub-banner.png')), 'ApyHub banner asset is missing');
check(fs.existsSync(path.join(root, 'assets', 'featured', 'coreclaw-banner.png')), 'CoreClaw banner asset is missing');
check(mainReadme.indexOf('ApyHub Utility API Collection') < mainReadme.indexOf('CoreClaw Web, Social &amp; Commerce Scraper APIs'), 'Partner collections must remain alphabetically ordered');
check(mainReadme.includes('(./SPONSORED_PARTNERS.md)'), 'Main README is missing the sponsored placement policy');
check(!mainReadme.includes('All links include affiliate tracking'), 'Main README contains the removed affiliate-tracking note');
check(readmeGenerator.includes("name: 'ApyHub Utility API Collection'"), 'README generator is missing the ApyHub partner collection');
check(readmeGenerator.includes("name: 'CoreClaw Web, Social & Commerce Scraper APIs'"), 'README generator is missing the CoreClaw partner collection');
check(readmeGenerator.includes('### Sponsored: KamdenAI'), 'README generator is missing the KamdenAI sponsor block');
check(!readmeGenerator.includes('buymeacoffee.com'), 'README generator would restore the retired coffee-support block');

async function validateUrl(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': 'API-Mega-List-Link-Validator/1.0' }
        });
        return { url, status: response.status, ok: response.ok };
    } catch (error) {
        return { url, status: 0, ok: false, error: error.message };
    } finally {
        clearTimeout(timeout);
    }
}

async function validateInBatches(urls, concurrency = 8) {
    const results = [];
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < urls.length) {
            const index = nextIndex++;
            results[index] = await validateUrl(urls[index]);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
}

async function main() {
    if (process.argv.includes('--check-links')) {
        const results = await validateInBatches(coreclawUrls);
        const failures = results.filter(result => !result.ok);
        for (const failure of failures) {
            errors.push(`CoreClaw link failed (${failure.status || failure.error}): ${failure.url}`);
        }
        console.log(`Live CoreClaw links checked: ${results.length - failures.length}/${results.length} successful`);
    }

    if (errors.length > 0) {
        console.error('\nPartner collection validation failed:');
        for (const error of errors) console.error(`- ${error}`);
        process.exitCode = 1;
        return;
    }

    console.log(`ApyHub API links: ${uniqueApyhubUrls.length} unique (${apyhubUrls.length} category placements)`);
    console.log(`CoreClaw scraper API links: ${coreclawUrls.length}`);
    console.log(`CoreClaw categories: ${categoryCounts.length} (${categoryCounts.reduce((sum, count) => sum + count, 0)} listings)`);
    console.log('Partner collection validation passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
