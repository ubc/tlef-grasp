const { samlErrorHandler } = require('../../src/middleware/samlErrorHandler');

describe('samlErrorHandler', () => {
  function res() {
    return { redirect: jest.fn() };
  }

  it('sends a stale request id back to login instead of a 500', () => {
    const response = res();
    const next = jest.fn();

    samlErrorHandler(new Error('InResponseTo is not valid'), {}, response, next);

    expect(response.redirect).toHaveBeenCalledWith('/auth/login?error=stale_login');
    expect(next).not.toHaveBeenCalled();
  });

  it('sends a missing request id back to login', () => {
    const response = res();
    const next = jest.fn();

    samlErrorHandler(new Error('InResponseTo is missing from response'), {}, response, next);

    expect(response.redirect).toHaveBeenCalledWith('/auth/login?error=stale_login');
  });

  it('passes a signature failure through so it is logged as a real error', () => {
    const response = res();
    const next = jest.fn();
    const error = new Error('Invalid signature');

    samlErrorHandler(error, {}, response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(response.redirect).not.toHaveBeenCalled();
  });
});
