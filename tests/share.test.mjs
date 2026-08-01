import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFamilyShareUrl,
  createFamilyShareBundle,
  decodeSharePayload,
  defaultFamilyShareFields,
  encodeSharePayload,
  familyShareSize,
  mergeFamilyPlan
} from '../src/share.js';

test('family share excludes sensitive fields by default', () => {
  const plan = {
    primaryMeetingPlace: '中央公園',
    secondaryMeetingPlace: '駅前広場',
    contactRule: '171を使う',
    supportPlan: '医療情報を含む内容',
    outOfAreaContact: '090-0000-0000',
    hazardDestinations: { earthquake: '小学校', flood: '高台' }
  };
  const bundle = createFamilyShareBundle(plan, defaultFamilyShareFields());
  assert.equal(bundle.data.primaryMeetingPlace, '中央公園');
  assert.equal(bundle.data.supportPlan, undefined);
  assert.equal(bundle.data.outOfAreaContact, undefined);
  assert.deepEqual(bundle.data.h, { earthquake: '小学校', flood: '高台' });
});

test('family share payload round-trips Japanese text', () => {
  const bundle = createFamilyShareBundle({ primaryMeetingPlace: '第一集合場所', contactRule: '連絡できないときは171' }, ['primaryMeetingPlace', 'contactRule']);
  const encoded = encodeSharePayload(bundle);
  const decoded = decodeSharePayload(encoded);
  assert.equal(decoded.data.primaryMeetingPlace, '第一集合場所');
  assert.equal(decoded.data.contactRule, '連絡できないときは171');
});

test('family share URL uses a dedicated import route and can be merged explicitly', () => {
  const bundle = createFamilyShareBundle({ primaryMeetingPlace: '公園', petPlan: 'ケージを持つ' }, ['primaryMeetingPlace', 'petPlan']);
  const url = buildFamilyShareUrl(bundle, 'https://example.test/mamoreru-inochi/');
  assert.match(url, /family=/);
  assert.match(url, /#\/family\/import$/);
  const merged = mergeFamilyPlan({ primaryMeetingPlace: '旧地点', notes: '残す' }, bundle);
  assert.equal(merged.primaryMeetingPlace, '公園');
  assert.equal(merged.petPlan, 'ケージを持つ');
  assert.equal(merged.notes, '残す');
});

test('family share reports whether a payload is practical for QR', () => {
  const bundle = createFamilyShareBundle({ primaryMeetingPlace: '公園' }, ['primaryMeetingPlace']);
  const size = familyShareSize(bundle, 'https://example.test/app/');
  assert.equal(size.suitableForQr, true);
  assert.ok(size.urlCharacters > size.payloadCharacters);
});
