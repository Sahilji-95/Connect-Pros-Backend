import express, { urlencoded } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import postRoute from "./routes/post.route.js";
import userRoute from "./routes/users.route.js";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { generalLimiter } from "./middleware/rate-limiter.js";

dotenv.config();

let app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  }),
);

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

app.use(generalLimiter);

app.use(postRoute);
app.use(userRoute);

const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    app.listen(9090, () => {
      console.log("Server running on port 9090");
    });
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

start();
