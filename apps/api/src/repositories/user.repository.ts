import UserModel from '../models/user.model';

export const USER_PUBLIC_SELECT = '-passwordHash -twoFactorEnabled';

const populateUser = (query: any) => query
  .select(USER_PUBLIC_SELECT)
  .populate('role', 'code name level')
  .populate('organization', 'name code type')
  .populate('department', 'name code')
  .populate('manager', 'username fullName email');

export const userRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number) {
    return populateUser(UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit));
  },

  count(filter: Record<string, unknown>) {
    return UserModel.countDocuments(filter);
  },

  findPublicById(id: string) {
    return populateUser(UserModel.findById(id));
  },

  findById(id: string) {
    return UserModel.findById(id);
  },

  findByIdWithPassword(id: string) {
    return UserModel.findById(id)
      .select('+passwordHash')
      .populate('role', 'code name level');
  },

  findByUsernameWithPassword(username: string) {
    return UserModel.findOne({ username }).select('+passwordHash');
  },

  findByLoginWithPassword(login: string) {
    return UserModel.findOne({
      $or: [
        { username: login },
        { email: login },
      ],
    })
      .select('+passwordHash')
      .populate('role', 'code name level');
  },

  findAuthById(id: string) {
    return UserModel.findById(id)
      .select('username fullName email status role organization department')
      .populate('role', 'code name level')
      .populate('department', '_id');
  },

  create(data: Record<string, unknown>) {
    return UserModel.create(data);
  },

  save(user: any) {
    return user.save();
  },

  deleteById(id: string) {
    return UserModel.findByIdAndDelete(id);
  },
};
