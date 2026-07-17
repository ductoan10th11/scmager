export type AuthUser = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  position?: string | null;
  role: {
    id: string;
    code: string;
    name?: string;
    level: number;
  };
  organization: string | null; // ObjectId string of the user's org
  department: string | null;   // ObjectId string of the user's department
  status: string;
};
