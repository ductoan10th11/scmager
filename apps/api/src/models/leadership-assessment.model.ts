import { Schema, model, models } from 'mongoose';

/**
 * The three leadership criteria (d, đ, e) of form PL4 that the KPI workbook
 * reserves for managers but the system cannot derive from documents:
 *   d  — result of the field the person leads
 *   đ  — ability to organise and carry out assigned work
 *   e  — ability to unite the staff under their management
 *
 * Only a higher-level leader rates them, one record per person per month.
 */
const leadershipAssessmentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Vietnam-local month key, YYYY-MM, matching the performance page period.
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    fieldResultScore: { type: Number, min: 0, max: 1, default: null },
    executionScore: { type: Number, min: 0, max: 1, default: null },
    cohesionScore: { type: Number, min: 0, max: 1, default: null },
    note: { type: String, trim: true, default: '' },
    ratedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ratedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

leadershipAssessmentSchema.index({ organization: 1, user: 1, period: 1 }, { unique: true });

export const LeadershipAssessmentModel =
  models.LeadershipAssessment || model('LeadershipAssessment', leadershipAssessmentSchema);
export default LeadershipAssessmentModel;
