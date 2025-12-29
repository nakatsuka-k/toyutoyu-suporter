const crypto = require("crypto");

function verifyLineSignature({ channelSecret, rawBodyBuffer, signature }) {
  if (!channelSecret) return false;
  if (!signature) return false;

  const digest = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBodyBuffer)
    .digest("base64");

  const expected = Buffer.from(digest);
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

module.exports = {
  verifyLineSignature,
};
