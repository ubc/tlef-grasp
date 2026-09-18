const { test, expect, request: playwrightRequest } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse } = require('./helpers');
const { getGuestPersonaUser } = require('./seed');

// Manual course access (issue #115) on the Users page, as bio_prof2 in the
// seeded BIOC 302 course: search for an account that has signed in to GRASP
// but is in no course (the plain `student` persona), add it straight in as a
// TA, see the grant on the roster with who made it, revoke it again, and see
// both steps in the access history. Opt-in (E2E_SAML=1).
//
// The `student` persona is logged in by saml.setup.js (so its grasp_user row
// exists) but is never seeded into any course, which makes it the guest here.
// Its email and names are whatever the local IdP / academic-API fake last
// wrote on login, so they are read from the database rather than hardcoded,
// and rows are matched on any of them.
const IDP_ENABLED = process.env.E2E_SAML === '1';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let courseId = null;
let guest = null; // { _id, email, displayName, legalName }
let guestRowPattern = null;

async function findGuestMember(api) {
  const rosterRes = await api.get(`/api/users/course/${courseId}`);
  expect(rosterRes.ok(), 'instructor can read the seeded roster').toBe(true);
  const roster = await rosterRes.json();
  return (roster.users || []).find((member) => String(member.userId) === guest._id) || null;
}

// Leave the seeded course as we found it, whether or not the run got as far
// as the UI removal.
async function removeGuestIfPresent(api) {
  const guest = await findGuestMember(api);
  if (!guest) return;
  const removal = await api.delete(
    `/api/users/course/${courseId}/remove/${String(guest.userId)}`
  );
  expect(removal.ok(), 'resetting the guest membership succeeds').toBe(true);
}

function guestRow(page) {
  return page.getByRole('row').filter({ hasText: guestRowPattern });
}

test.describe.serial('Instructor adds a guest as TA (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test.beforeAll(async () => {
    guest = await getGuestPersonaUser();
    guestRowPattern = new RegExp(
      [guest.legalName, guest.displayName, guest.email]
        .filter(Boolean)
        .map(escapeRegExp)
        .join('|')
    );
  });

  test.afterAll(async () => {
    if (!courseId) return;
    const api = await playwrightRequest.newContext({
      baseURL: `http://localhost:${process.env.TLEF_GRASP_PORT || 8052}`,
      storageState: BIO_PROF2_AUTH_FILE,
    });
    try {
      await removeGuestIfPresent(api);
    } finally {
      await api.dispose();
    }
  });

  test('searches by email and adds the account as a TA, recorded under the instructor', async ({
    page,
  }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    courseId = course.id;
    await removeGuestIfPresent(page.request);

    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Add People' })).toBeVisible();

    // Nothing is listed until something is typed: the picker is search-only.
    await expect(page.getByRole('button', { name: /Add as TA/ })).toHaveCount(0);

    const search = page.getByLabel('Search accounts by email or name');
    await search.fill('st');
    await expect(page.getByText(/Type at least 3 characters/)).toBeVisible();

    await search.fill(guest.email);
    const result = page.getByRole('listitem').filter({ hasText: guest.email });
    await expect(result).toBeVisible();
    await expect(result.getByText('Not in any course yet')).toBeVisible();

    await result.getByRole('button', { name: 'Add as TA' }).click();
    await expect(page.getByRole('heading', { name: 'Add as TA' })).toBeVisible();
    await expect(page.getByText(/recorded under your name/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Add as TA' }).click();

    // The roster now carries the TA with the provenance line, and the picker
    // no longer offers them.
    const row = guestRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByText('TA', { exact: true })).toBeVisible();
    await expect(row.getByText(/Added by .* on /)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: guest.email })).toHaveCount(0);

    // The API agrees on every detail the audit needs.
    const member = await findGuestMember(page.request);
    expect(member).toBeTruthy();
    expect(member.courseRole).toBe('ta');
    expect(member.source).toBe('manual');
    const me = await (await page.request.get('/api/current-user')).json();
    expect(String(member.addedBy?._id)).toBe(String(me.user._id));
    expect(new Date(member.joinedAt).getTime()).toBeGreaterThan(Date.now() - 5 * 60 * 1000);
  });

  test('the access history shows the grant, and revoking it from the roster is logged too', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/users');

    await page.getByRole('button', { name: 'Show history' }).click();
    const history = page.locator('#access-history-panel');
    await expect(history).toBeVisible();
    await expect(
      history.getByText(/added .* to the course as TA/).first()
    ).toBeVisible();

    const row = guestRow(page);
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(
      page.getByRole('heading', { name: 'Remove User from Course' })
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();

    await expect(guestRow(page)).toHaveCount(0);
    await expect(
      history.getByText(/removed .* from the course \(was TA\)/).first()
    ).toBeVisible();

    expect(await findGuestMember(page.request)).toBeNull();

    const logRes = await page.request.get(`/api/users/course/${courseId}/access-log`);
    expect(logRes.ok()).toBe(true);
    const { events } = await logRes.json();
    const actions = events
      .filter((event) => String(event.targetUserId) === guest._id)
      .map((event) => `${event.action}:${event.role}`);
    expect(actions.slice(0, 2)).toEqual(['removed:ta', 'added:ta']);
    // The actor is the instructor whose session performed both steps.
    const me = await (await page.request.get('/api/current-user')).json();
    expect(String(events[0].actorUserId)).toBe(String(me.user._id));
  });
});
