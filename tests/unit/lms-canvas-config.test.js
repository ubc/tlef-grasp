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

describe('Canvas integration scopes (CANVAS_SCOPES)', () => {
  const { createCanvasIntegration } = require('../../src/lms/canvas');
  const completeEnv = {
    CANVAS_DOMAIN: 'canvas.example.test',
    CANVAS_CLIENT_ID: 'client-id',
    CANVAS_CLIENT_SECRET: 'client-secret',
    CANVAS_REDIRECT_URI: 'https://grasp.example.test/api/lms/canvas/auth/callback',
  };
  const saved = {};

  beforeEach(() => {
    for (const name of [...Object.keys(completeEnv), 'CANVAS_SCOPES']) {
      saved[name] = process.env[name];
    }
    Object.assign(process.env, completeEnv);
    delete process.env.CANVAS_SCOPES;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('requests no scopes and enables every capability when CANVAS_SCOPES is unset', () => {
    const integration = createCanvasIntegration();

    expect(integration.config).not.toHaveProperty('scopes');
    expect(integration.scopes).toEqual([]);
    expect(integration.capabilities).toEqual({ link: true, rosterSync: true, assignments: true });
  });

  it('requests exactly the configured scopes and gates capabilities on them', () => {
    process.env.CANVAS_SCOPES =
      'url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/sections,' +
      'url:GET|/api/v1/courses/:course_id/enrollments url:GET|/api/v1/courses/:course_id/assignments';

    const integration = createCanvasIntegration();

    expect(integration.config.scopes).toEqual([
      'url:GET|/api/v1/courses',
      'url:GET|/api/v1/courses/:course_id/sections',
      'url:GET|/api/v1/courses/:course_id/enrollments',
      'url:GET|/api/v1/courses/:course_id/assignments',
    ]);
    expect(integration.capabilities).toEqual({ link: true, rosterSync: true, assignments: false });
  });

  it('sends the configured scopes as one space-delimited scope parameter on the authorize URL', () => {
    process.env.CANVAS_SCOPES = 'url:GET|/api/v1/courses,url:GET|/api/v1/courses/:course_id/enrollments';
    const { canvas } = require('@ubc/ubc-genai-toolkit-lms-integration');

    const { config } = createCanvasIntegration();
    const url = new URL(canvas.buildAuthorizeUrl(config, { state: 's', scopes: config.scopes }));

    expect(url.searchParams.getAll('scope')).toEqual([
      'url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/enrollments',
    ]);
  });
});
