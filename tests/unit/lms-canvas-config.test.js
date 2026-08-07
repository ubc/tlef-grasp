const {
  REQUIRED_CANVAS_ENV_VARS,
  isCanvasConfigured,
} = require('../../src/lms/canvas');

describe('Canvas integration environment gating', () => {
  const completeEnv = {
    CANVAS_DOMAIN: 'canvas.example.test',
    CANVAS_CLIENT_ID: 'client-id',
    CANVAS_CLIENT_SECRET: 'client-secret',
    CANVAS_REDIRECT_URI: 'https://grasp.example.test/api/lms/canvas/auth/callback',
  };

  it('is enabled only when every required value is non-empty', () => {
    expect(isCanvasConfigured(completeEnv)).toBe(true);

    for (const name of REQUIRED_CANVAS_ENV_VARS) {
      expect(isCanvasConfigured({ ...completeEnv, [name]: '  ' })).toBe(false);
      expect(isCanvasConfigured({ ...completeEnv, [name]: undefined })).toBe(false);
    }
  });
});
