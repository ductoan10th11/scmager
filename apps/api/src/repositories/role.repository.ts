import RoleModel from '../models/role.model';

export type DefaultRole = {
  code: string;
  name: string;
  level: number;
  permissions: readonly string[];
};

export const roleRepository = {
  findById(id: string) {
    return RoleModel.findById(id);
  },

  findByCode(code: string) {
    return RoleModel.findOne({ code });
  },

  async upsertDefaults(roles: readonly DefaultRole[]) {
    for (const role of roles) {
      await RoleModel.updateOne(
        { code: role.code },
        {
          $setOnInsert: {
            code: role.code,
            name: role.name,
            level: role.level,
            permissions: role.permissions,
          },
        },
        { upsert: true },
      );
    }
  },
};
