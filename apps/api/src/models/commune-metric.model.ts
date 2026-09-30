import { Schema, model, models, Types } from 'mongoose';

export type CommuneCategory = 'CHUNG' | 'DANG_UY' | 'UBND' | 'MTTQ';

export interface ICommuneMetric {
  _id?: Types.ObjectId;
  organizationId?: Types.ObjectId | null;
  code: string;
  name: string;
  category: CommuneCategory;
  unit: string;
  actualValue: number;
  targetValue?: number | null;
  completionRate?: number | null;
  period: string;
  year: number;
  icon?: string;
  order?: number;
  isCore?: boolean;
  isConfirmed?: boolean;
  sourceReportId?: Types.ObjectId | null;
  sourceEvidence?: string;
  note?: string;
  updatedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const communeMetricSchema = new Schema<ICommuneMetric>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['CHUNG', 'DANG_UY', 'UBND', 'MTTQ'],
      required: true,
      index: true,
    },
    unit: {
      type: String,
      trim: true,
      default: '',
    },
    actualValue: {
      type: Number,
      required: true,
      default: 0,
    },
    targetValue: {
      type: Number,
      default: null,
    },
    completionRate: {
      type: Number,
      default: null,
    },
    period: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
      default: 2026,
      index: true,
    },
    icon: {
      type: String,
      trim: true,
      default: 'TrendingUp',
    },
    order: {
      type: Number,
      default: 0,
    },
    isCore: {
      type: Boolean,
      default: false,
      index: true,
    },
    isConfirmed: {
      type: Boolean,
      default: true,
      index: true,
    },
    sourceReportId: {
      type: Schema.Types.ObjectId,
      ref: 'CommuneReport',
      default: null,
      index: true,
    },
    sourceEvidence: {
      type: String,
      trim: true,
      default: '',
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index đảm bảo không trùng lặp mã chỉ tiêu trong cùng 1 kỳ của tổ chức
communeMetricSchema.index(
  { organizationId: 1, year: 1, period: 1, code: 1 },
  { unique: true }
);

communeMetricSchema.index({ category: 1, isConfirmed: 1, isCore: 1, order: 1 });

export const CommuneMetricModel =
  models.CommuneMetric || model<ICommuneMetric>('CommuneMetric', communeMetricSchema);
export default CommuneMetricModel;
