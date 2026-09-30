import CommuneMetricModel, { ICommuneMetric } from '../models/commune-metric.model';

export const communeMetricRepository = {
  find(filter: Record<string, unknown> = {}, sort: any = { order: 1, createdAt: 1 }) {
    return CommuneMetricModel.find(filter).sort(sort).populate('sourceReportId');
  },

  findById(id: string) {
    return CommuneMetricModel.findById(id).populate('sourceReportId');
  },

  findByCode(code: string, year: number, period: string, organizationId?: string | null) {
    const filter: Record<string, unknown> = {
      code: code.toUpperCase().trim(),
      year: Number(year),
      period: period.trim(),
    };
    if (organizationId !== undefined) {
      filter.organizationId = organizationId;
    }
    return CommuneMetricModel.findOne(filter);
  },

  async upsertMetric(data: Partial<ICommuneMetric>) {
    const filter: Record<string, unknown> = {
      code: String(data.code).toUpperCase().trim(),
      year: Number(data.year) || 2026,
    };
    if (data.organizationId !== undefined && data.organizationId !== null) {
      filter.organizationId = data.organizationId;
    } else {
      filter.organizationId = null;
    }

    const updateDoc = {
      ...data,
      code: String(data.code).toUpperCase().trim(),
      year: Number(data.year) || 2026,
      period: String(data.period || 'Tháng 9/2026').trim(),
      organizationId: data.organizationId || null,
      updatedAt: new Date(),
    };

    return CommuneMetricModel.findOneAndUpdate(
      filter,
      { $set: updateDoc },
      { upsert: true, new: true, runValidators: true }
    );
  },

  updateStatus(id: string, isConfirmed: boolean, updatedBy?: string | null) {
    return CommuneMetricModel.findByIdAndUpdate(
      id,
      { $set: { isConfirmed, ...(updatedBy ? { updatedBy } : {}) } },
      { new: true }
    );
  },

  count(filter: Record<string, unknown> = {}) {
    return CommuneMetricModel.countDocuments(filter);
  },

  deleteById(id: string) {
    return CommuneMetricModel.findByIdAndDelete(id);
  },

  deleteBySourceReportId(reportId: string) {
    return CommuneMetricModel.deleteMany({ sourceReportId: reportId });
  },
};

export default communeMetricRepository;
