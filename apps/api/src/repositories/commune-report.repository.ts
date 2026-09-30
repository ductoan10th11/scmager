import CommuneReportModel, { ICommuneReport } from '../models/commune-report.model';

export const communeReportRepository = {
  find(filter: Record<string, unknown> = {}, skip: number = 0, limit: number = 50) {
    return CommuneReportModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },

  findById(id: string) {
    return CommuneReportModel.findById(id);
  },

  findByCode(code: string, year?: number, organizationId?: string | null) {
    const filter: Record<string, unknown> = { code: code.trim() };
    if (year) filter.year = Number(year);
    if (organizationId !== undefined) filter.organizationId = organizationId;
    return CommuneReportModel.findOne(filter);
  },

  create(data: Partial<ICommuneReport>) {
    return CommuneReportModel.create(data);
  },

  update(id: string, data: Partial<ICommuneReport>) {
    return CommuneReportModel.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
  },

  deleteById(id: string) {
    return CommuneReportModel.findByIdAndDelete(id);
  },

  count(filter: Record<string, unknown> = {}) {
    return CommuneReportModel.countDocuments(filter);
  },
};

export default communeReportRepository;
