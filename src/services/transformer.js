/**
 * Transforms a complex Stellar SDK operation object into a simpler JSON payload
 * for the Web2 Webhook.
 * @param {Object} operation - The operation object from the Stellar SDK stream
 * @returns {Object} Simplified payload
 */
function transformPayload(operation) {
  // A standard payment or path_payment_strict_* will have these fields
  const payload = {
    id: operation.id,
    paging_token: operation.paging_token,
    transaction_hash: operation.transaction_hash,
    type: operation.type,
    created_at: operation.created_at,
    source_account: operation.source_account,
  };

  // Extract payment/asset specific fields
  if (operation.type === 'payment' || operation.type.startsWith('path_payment')) {
    payload.from = operation.from;
    payload.to = operation.to;
    payload.amount = operation.amount;
    payload.asset_type = operation.asset_type;
    
    if (operation.asset_type === 'native') {
      payload.asset_code = 'XLM';
    } else {
      payload.asset_code = operation.asset_code;
      payload.asset_issuer = operation.asset_issuer;
    }
  }

  return payload;
}

module.exports = { transformPayload };
