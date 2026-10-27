import express, { urlencoded } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import postRoute from "./routes/post.route.js";
import userRoute from "./routes/users.route.js";
import chatRoute from "./routes/chat.route.js";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { generalLimiter } from "./middleware/rate-limiter.js";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { socketAuth } from "./middleware/socketAuth.js";
import { registerChatSocket } from "./socket/chatSocket.js";

dotenv.config();

let app = express();
app.set("trust proxy", 1);

const httpServer = createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://connect-pros-frontend.vercel.app",
];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

app.set("io", io);
// // Debug 1: Engine.IO transport connection
// io.engine.on("connection", (engineSocket) => {
//   console.log("Engine.IO connected:", engineSocket.id);

//   engineSocket.on("close", (reason) => {
//     console.log("Engine.IO closed:", reason);
//   });
// });

// // Debug 2: Socket.IO namespace authentication handshake
// io.use((socket, next) => {
//   console.log("Socket.IO handshake received");
//   next();
// });

// httpServer.on("upgrade", (request, socket) => {
//   console.log("HTTP upgrade request:", request.url);
// });

io.use(socketAuth);
registerChatSocket(io);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  }),
);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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
app.use(chatRoute);

const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    httpServer.listen(9090, () => {
      console.log("Server running on port 9090");
    });
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

start();
