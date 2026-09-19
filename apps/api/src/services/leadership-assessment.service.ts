import { isValidObjectId } from 'mongoose';
import { LeadershipAssessmentModel, UserModel } from '../models';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden, notFound } from '../utils/http-error';

const idOf = (value: any) => String(value?._id ?? value ?? '');

// Only leaders above department level rate the three PL4 leadership criteria.
const RATER_ROLES = ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'];

const SCORE_FIELDS = ['fieldResultScore', 'executionScore', 'cohesionScore'] as const;

const parsePeriod = (value: unknown) => {
  const period = String(value ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest('period must use YYYY-MM.');
  return period;
};

// PL4 states each criterion as a ratio, so scores stay within 0..1 the same way
// the workbook's own example rows do.
const parseScore = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw badRequest(`${field} must be a number between 0 and 1.`);
  }
  return score;
};

const ensureRater = (actor: AuthUser) => {
  if (!RATER_ROLES.includes(actor.role.code)) {
    throw forbidden('Only a commune leader or office chief can rate leadership criteria.');
  }
};

export const listLeadershipAssessmentsService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const period = parsePeriod(query.period);
  if (!actor.organization && actor.role.code !== 'ADMIN') {
    throw forbidden('User has no organization assigned.');
  }
  const filter: Record<string, unknown> = { period };
  if (actor.organization) filter.organization = actor.organization;
  // A department leader may read their own record; everyone else must be a rater.
  if (!RATER_ROLES.includes(actor.role.code)) {
    if (actor.role.code !== 'DEPARTMENT_LEADER') throw forbidden('Access denied.');
    filter.user = actor.id;
  }
  const items = await LeadershipAssessmentModel.find(filter)
    .populate('user', '_id fullName username department')
    .populate('ratedBy', '_id fullName username')
    .lean();
  return { data: items };
};

export const upsertLeadershipAssessmentService = async (actor: AuthUser, body: Record<string, unknown>) => {
  ensureRater(actor);
  const period = parsePeriod(body.period);
  const userId = String(body.userId ?? '');
  if (!isValidObjectId(userId)) throw badRequest('userId must be a valid ObjectId.');

  const target: any = await UserModel.findById(userId)
    .select('_id organization department role status')
    .populate('role', 'code name level')
    .lean();
  if (!target || target.status !== 'ACTIVE') throw notFound('User not found.');
  if (actor.role.code !== 'ADMIN' && idOf(target.organization) !== actor.organization) {
    throw forbidden('Access denied.');
  }
  if (target.role?.code !== 'DEPARTMENT_LEADER') {
    throw badRequest('Leadership criteria only apply to department leaders.');
  }

  const scores: Record<string, number | null> = {};
  for (const field of SCORE_FIELDS) scores[field] = parseScore(body[field], field);
  if (SCORE_FIELDS.every((field) => scores[field] === null)) {
    throw badRequest('Provide at least one leadership score.');
  }

  const note = body.note === undefined || body.note === null ? '' : String(body.note).trim().slice(0, 2_000);
  const now = new Date();
  const assessment = await LeadershipAssessmentModel.findOneAndUpdate(
    { organization: idOf(target.organization), user: userId, period },
    { $set: { ...scores, note, ratedBy: actor.id, ratedAt: now } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();

  return { data: assessment };
};
