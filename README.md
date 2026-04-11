# Stellar-to-Web2 Hook

A Node.js background service that listens to the Stellar network in real-time, monitors specific transactions based on dynamic rules, and reliably pushes those events to Web2 endpoints via HMAC-signed Webhook payloads.

## Features

- **Paging Cursor Management**: Saves stream cursors in MongoDB. If the service restarts, no transaction data is lost.
- **Dynamic Watch Filters**: Filter streams by specific accounts, `assetCode`, and `minAmount`.
- **429 Rate Limit Handling**: Automatic exponential backoff when encountering Stellar Horizon's Too Many Requests limits.
- **HMAC Signatures**: Every outgoing Webhook includes an `X-Stellar-Signature` header signed with your customizable secret key.
- **Fail-Safe Webhooks**: Powered by `axios-retry`, webhooks will automatically retry if your Web2 server is temporarily down.

## Prerequisites

- [Node.js](https://nodejs.org/en/) (v14 or above typically recommended)
- [MongoDB](https://www.mongodb.com/) (Local or Atlas URI)

## Installation

1. Clone or download the repository to your host machine.
2. Inside the root directory, install the required packages:

```bash
npm install
```

## Configuration

### 1. Environment Variables

Create or tweak the `.env` file in the root directory to define global settings:

```ini
MONGODB_URI=mongodb://localhost:27017/stellar-hook
STELLAR_NETWORK=TESTNET
# Use 'PUBLIC' for Mainnet, 'TESTNET' for Testnet
```

### 2. Stream & Hook Rules

Define the accounts and tokens you want to track using `src/config.json`. 

```json
{
  "watches": [
    {
      "id": "watch_usdc_payments",
      "address": "GA5ZSEJYB37JRC52ZGMCEIGYBXNE2GB3Z3YJ2Q5OQ3G6A4QJ2ZMBW33T",
      "assetCode": "USDC",
      "minAmount": "100",
      "webhookUrl": "http://localhost:3000/webhook",
      "hmacSecret": "my_super_secret_key"
    }
  ]
}
```

*Note: If no `assetCode` or `minAmount` is provided in a watch object, the service will forward all payment actions for that account.*

## Running the Service

You can simply deploy the service using Node:

```bash
node src/index.js
```

## Verifying the Webhook

When your endpoint receives a POST request from the service, it will contain the JSON payload and the HMAC SHA-256 signature header. To verify it in Node.js (Express example):

```javascript
const crypto = require('crypto');

app.post('/webhook', (req, res) => {
  const payloadString = JSON.stringify(req.body);
  const signature = req.headers['x-stellar-signature'];
  const secret = 'my_super_secret_key'; // Use the same secret defined in config

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');

  if (signature === expectedSignature) {
    console.log("Stellar Webhook verified successfully!");
    res.status(200).send();
  } else {
    console.error("Signature mismatch!");
    res.status(403).send();
  }
});
```
