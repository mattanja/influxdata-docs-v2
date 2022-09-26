/*
This script auto-populates Flux versions in data/flux_influxdb_versions.yml.
*/

const axios = require('axios')
const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')

// GitHub token to access files in the private InfluxDB Enterprise repo
const githubToken = process.env.GITHUB_TOKEN

if (typeof githubToken === 'undefined') {
  console.error(`
A GitHub token is required for this operation. Please set a GITHUB_TOKEN environment variable.
Use the GitHub token stored in the Docs Team vault in 1Password.
  `);
  process.exit(0);
}

// Get the latest version of Flux
async function getLatestFlux() {
  const { request } = await axios
    .get('https://github.com/influxdata/flux/releases/latest')
    .catch(error => console.error(error))

  return request.path.match(/\/v(\d.*)$/)[1];
}

// Retrieve the dependency file for a specific InfluxDB version
async function getVersionDeps(minorVersion, repo) {
  const url = `https://raw.githubusercontent.com/influxdata/${repo}/${minorVersion}/go.mod`;
  const data = axios.get(url, {
      headers: {
        Authorization: `Token ${githubToken}`
      }
    }).then(res => res.data).catch(error => console.log(error.toJSON));

  return data
}

// Extract the Flux version from the InfluxDB dependency list
async function getFluxVersion(minorVersion, product='oss') {
  const repo = (product === 'oss') ? 'influxdb' : 'plutonium';
  const depsBody = await getVersionDeps(minorVersion, repo);

  if (depsBody == null) {
    console.error(`Could not find flux version for ${minorVersion} (${product})`)
  } else {
    const fluxVersion = depsBody.match(/github.com\/influxdata\/flux v(\d+\.\d+\.\d+)/)[1]

    return fluxVersion 
  }
}

// Loop through an InfluxDB version array, retrieve the Flux version packaged with
// each version of InfluxDB, and update the base version object with the new
// key-value pair
async function getAllFluxVersions(versionArr, product='oss', baseObj) {
  for (let index = 0; index < versionArr.length; index++) {
    const influxdbVersion = versionArr[index]
    const fluxVersion = await getFluxVersion(influxdbVersion, product)

    baseObj[influxdbVersion] = fluxVersion
  }
}

// Manually add a InfluxDB-version/Flux-version key-value pair to a versions object
function addVersion(versionObj, influxdbVer, fluxVer) {
  versionObj[influxdbVer] = fluxVer
}

// Load product data from the product data file
const productData = yaml.load(fs.readFileSync(path.resolve(__dirname,'../data/products.yml'), 'utf8'))

// Update InfluxDB version arrays by removing 'v' from each version and filtering
// out InfluxDB versions that don't have a Flux dependency in their go.mod
const ossVersionArr = productData.influxdb.versions.map((element, index) => {return element.replace('v', '')}).filter(element => parseFloat(element) >= 1.7).reverse();
const enterpriseVersionArr = productData.enterprise_influxdb.versions.map((element, index) => {return element.replace('v', '')}).filter(element => parseFloat(element) >= 1.9).reverse();

// Instantiate base Flux version variables
var ossVersions = {};
var enterpriseVersions = {};
var fluxVersions = {};

// Retrieve all Flux versions and write them to flux_influxdb_versions.yml
(async () => {
  await getAllFluxVersions(ossVersionArr, 'oss', ossVersions);
  await getAllFluxVersions(enterpriseVersionArr, 'enterprise', enterpriseVersions);

  // Manually add versions that aren't included in the original versions arrays
  await addVersion(ossVersions, 'nightly', await getFluxVersion('master'));
  await addVersion(enterpriseVersions, '1.8', await getFluxVersion('1.8'));
  await addVersion(enterpriseVersions, '1.7', await getFluxVersion('1.7'));

  // Build the Flux versions object that contains all necessary flux version information
  fluxVersions = {
    flux: {latest: await getLatestFlux()},
    cloud: {current: await getFluxVersion('master')},
    oss: ossVersions,
    enterprise: enterpriseVersions
  }

  const commentString = `# This file is auto-generated by flux-build-scripts/update-flux-versions.js.
# It is used to identify what versions of Flux are installed with each version
# of InfluxDB. You are welcome to make changes to this file, but they will be
# overwritten whenever flux-build-scripts/update-flux-versions.js runs in the
# build/deploy process.
`
  fluxVersionsYAML = yaml.dump(fluxVersions)

  // Write the comment and yaml to the flux_influxdb_versions.yml data file
  fs.writeFileSync(path.resolve(__dirname,'../data/flux_influxdb_versions.yml'), commentString + '\n' + fluxVersionsYAML)
})().then(data => console.log('Flux versions updated!'))
