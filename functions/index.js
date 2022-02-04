const functions = require("firebase-functions");
const fetch = require('node-fetch');
const twApi = require('twitter-api-v2').default;
const {Configuration, OpenAIApi} = require('openai');
require('dotenv').config({ path: '../.env' });
console.log(process.env);
const config = new Configuration({
  organization: process.env.OPENAI_OID,
  apiKey: process.env.OPENAI_APIKEY 
})

const openai = new OpenAIApi(config);
const constructEndpoint = (endpoint, params) => {
  const formioDb = `${process.env.FORMIO_PROJECT}/${endpoint}/submission${params? '?' + params: ''}`; 
  return formioDb;
}

const deliveryGuy =  async (method, endpoint, data, params) => {
  let settings = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-token': process.env.FORMIO_TOKEN
    },
    body: JSON.stringify(data)
  }
  if(method === 'GET') {
    delete settings.body;
  }
  return await fetch(constructEndpoint(endpoint, params), settings)
}

const callbackURL = 'http://localhost:5000/tw-bot-915c5/us-central1/callback';
const twClient = new twApi({
  clientId: process.env.TW_APIKEY,
  clientSecret: process.env.TW_SECRET
})

exports.auth = functions.https.onRequest( async (req, res)=> {
  const {url, codeVerifier, state} = twClient.generateOAuth2AuthLink(
    callbackURL,
    {scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access']}
  )
  await deliveryGuy('POST', 'twbotverifier', {data:{codeVerifier, state}}, null);
  
  res.redirect(url);
})

exports.callback = functions.https.onRequest(async (req, res)=> {
  const {code, state} = req.query;
  const valid = await deliveryGuy('GET', 'twbotverifier', null, `data.state=${state}`);
  const storedState = await valid.json();
  console.log(storedState);

  if(storedState.length === 0) {
    res.send('stored tokens do not match ');
  }
  
  const {codeVerifier} = storedState[0].data;

  const {
    client: loggedClient,
    accessToken,
    refreshToken
  } = await twClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL
  });

  const saveTokens = await deliveryGuy('POST', 'twbottokens', {data: {accessToken, refreshToken}}, null);
  const {data} = await loggedClient.v2.me();
  res.send(data);
})

exports.tweet = functions.https.onRequest(async (req, res)=> {
  const response = await deliveryGuy('GET', 'twbottokens', null, null);
  const tokens = await response.json();
  console.log(tokens[0]);
  if(tokens.length === 0) {
    res.status(400);
  }
  
  const {refreshToken} = tokens[0].data;
  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken
  } = await twClient.refreshOAuth2Token(refreshToken);
  const saveTokens = await deliveryGuy('POST', 'twbottokens', {data: {accessToken, refreshToken: newRefreshToken}}, null);

  const nextTweet = await openai.createCompletion('text-davinci-001', {
    prompt: 'tweet something about blogs',
    max_tokens:64
  })
  const {data} = await refreshedClient.v2.tweet(nextTweet.data.choices[0].text)
  res.send(data)
})