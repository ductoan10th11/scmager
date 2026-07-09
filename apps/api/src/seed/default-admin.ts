import { userService } from '../services/user.service';

export const seedDefaultAdmin = async () => {
  await userService.ensureDefaultAdmin();
};
