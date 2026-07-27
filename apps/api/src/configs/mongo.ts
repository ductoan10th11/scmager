import mongoose from "mongoose";
import { getRuntimeConfig } from "./runtime-config";

export const connectDB = async () => {
  try {
    const mongoURI = getRuntimeConfig().mongoUri;

    await mongoose.connect(mongoURI);
    console.log("MongoDB connected.");
  } catch (error) {
    console.error(
      "MongoDB connection failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    throw error;
  }
};
