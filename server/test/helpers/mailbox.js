import { sendCode } from '../../src/services/mail.js';

// What the code under test asked the mailer to send (the mock in helpers/mail-mock.js records it): { to, purpose, code, language }.
export const sentMail = () => sendCode.mock.calls.map(([request]) => request);

// The newest code mailed to this address.
export const lastCode = (to) => sentMail().findLast((mail) => mail.to === to)?.code;

// The next send fails the way a refused Gmail login does: with the plain error services/mail.js throws.
export const failNextSend = () => sendCode.mockRejectedValueOnce(new Error('the email could not be sent'));

export { sendCode };

