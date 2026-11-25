// TAs can only ever use the pages in TA_GRANTABLE_PERMISSION_KEYS. The
// instructor's TA-permissions editor offers only those, and presets that would
// grant anything else are not offered. The server keeps its own copy of the
// list (utils/ta-permissions.js); the last test keeps the two in step.

import { describe, it, expect } from '@jest/globals';
import { createRequire } from 'module';
import {
  TA_PERMISSIONS,
  TA_GRANTABLE_PERMISSION_KEYS,
  TA_GRANTABLE_PERMISSIONS,
  TA_PERMISSION_PRESETS,
  TA_PATH_PERMISSION,
  isTaGrantable,
} from '../../client/src/lib/permissions.js';

const require = createRequire(import.meta.url);

describe('TA grantable pages', () => {
  it('are Dashboard, Course Materials, Question Generation and Question Bank', () => {
    expect(TA_GRANTABLE_PERMISSION_KEYS).toEqual([
      'dashboard',
      'courseMaterials',
      'questionGeneration',
      'questionBank',
    ]);
  });

  it.each(['quizzes', 'quizScores', 'questionFlags', 'users', 'mySections', 'settings'])(
    'do not include %s',
    (key) => {
      expect(isTaGrantable(key)).toBe(false);
    }
  );

  it('gate My Sections like every other TA page', () => {
    expect(TA_PATH_PERMISSION['/my-sections']).toBe('mySections');
  });

  it('are the only pages the instructor is offered', () => {
    expect(TA_GRANTABLE_PERMISSIONS.map((perm) => perm.key)).toEqual(TA_GRANTABLE_PERMISSION_KEYS);
    expect(TA_PERMISSIONS.length).toBeGreaterThan(TA_GRANTABLE_PERMISSIONS.length);
  });

  it('offer no preset that grants a closed page, and no duplicate preset', () => {
    // Grader needs scores and flags; Content Assistant grants the same as Full.
    expect(TA_PERMISSION_PRESETS.map((preset) => preset.id)).toEqual(['full']);
    for (const preset of TA_PERMISSION_PRESETS) {
      expect(Object.keys(preset.permissions)).toEqual(TA_GRANTABLE_PERMISSION_KEYS);
    }
  });

  it('match the server list', () => {
    const server = require('../../src/utils/ta-permissions.js');
    expect(TA_GRANTABLE_PERMISSION_KEYS).toEqual(server.TA_GRANTABLE_PERMISSION_KEYS);
    expect(TA_PERMISSIONS.map((perm) => perm.key).sort()).toEqual([...server.ALL_TA_PERMISSION_KEYS].sort());
  });
});
