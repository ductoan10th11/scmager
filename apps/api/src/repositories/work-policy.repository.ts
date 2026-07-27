import WorkPolicyModel from '../models/work-policy.model';

export const workPolicyRepository = {
  findForOrganization(organization: string) {
    return WorkPolicyModel.findOne({ organization }).lean();
  },
};
