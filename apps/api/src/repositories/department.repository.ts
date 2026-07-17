import DepartmentModel from '../models/department.model';

const populateDepartment = (query: any) => query
  .populate('parent', 'name code isActive')
  .populate('leader', 'username fullName position email');

export const departmentRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number) {
    return populateDepartment(
      DepartmentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    );
  },

  findAll(filter: Record<string, unknown>) {
    return populateDepartment(DepartmentModel.find(filter).sort({ createdAt: -1 }));
  },

  count(filter: Record<string, unknown>) {
    return DepartmentModel.countDocuments(filter);
  },

  findById(id: string) {
    return populateDepartment(DepartmentModel.findById(id));
  },

  findRawById(id: string) {
    return DepartmentModel.findById(id);
  },

  create(data: Record<string, unknown>) {
    return DepartmentModel.create(data);
  },

  save(department: any) {
    return department.save();
  },
};
