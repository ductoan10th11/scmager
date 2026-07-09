import OrganizationModel from '../models/organization.model';

const populateOrganization = (query: any) => query
  .populate('parent', 'name code type isActive');

export const organizationRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number) {
    return populateOrganization(
      OrganizationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    );
  },

  count(filter: Record<string, unknown>) {
    return OrganizationModel.countDocuments(filter);
  },

  findById(id: string) {
    return populateOrganization(OrganizationModel.findById(id));
  },

  findRawById(id: string) {
    return OrganizationModel.findById(id);
  },

  create(data: Record<string, unknown>) {
    return OrganizationModel.create(data);
  },

  save(organization: any) {
    return organization.save();
  },
};
