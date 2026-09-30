import { Schema, model, models, Types } from 'mongoose';
import { CommuneCategory } from './commune-metric.model';

export type CommuneReportStatus = 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ICommuneReport {
  _id?: Types.ObjectId;
  organizationId?: Types.ObjectId | null;
  code: string;
  title: string;
  category: CommuneCategory;
  period: string;
  year: number;
  fileName: string;
  fileSize?: string;
  fileUrl?: string;
  uploadedBy?: string;
  agency?: string;
  status?: CommuneReportStatus;
  extractedCount?: number;
  summary?: string;
  rawText?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const communeReportSchema = new Schema<ICommuneReport>(
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
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['CHUNG', 'DANG_UY', 'UBND', 'MTTQ'],
      default: 'UBND',
      required: true,
      index: true,
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
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: String,
      trim: true,
      default: '',
    },
    fileUrl: {
      type: String,
      trim: true,
      default: '',
    },
    uploadedBy: {
      type: String,
      trim: true,
      default: '',
    },
    agency: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['DRAFT', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'COMPLETED',
      index: true,
    },
    extractedCount: {
      type: Number,
      default: 0,
    },
    summary: {
      type: String,
      trim: true,
      default: '',
    },
    rawText: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

communeReportSchema.index({ organizationId: 1, year: 1, category: 1, createdAt: -1 });

export const CommuneReportModel =
  models.CommuneReport || model<ICommuneReport>('CommuneReport', communeReportSchema);
export default CommuneReportModel;
