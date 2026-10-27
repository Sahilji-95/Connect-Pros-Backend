import { io } from "socket.io-client";

const token = process.env.RECIPIENT_JWT_TOKEN;

if (!token) {
  console.error("RECIPIENT_JWT_TOKEN is missing");
  process.exit(1);
}

const socket = io("http://127.0.0.1:9090", {
  path: "/socket.io",
  transports: ["websocket"],
  extraHeaders: {
    Cookie: `token=${token.trim()}`,
  },
  timeout: 10000,
  reconnection: false,
});

socket.on("connect", () => {
  console.log("RECIPIENT CONNECTED:", socket.id);
});

socket.on("chat:message", (message) => {
  // Only mark messages addressed to this recipient as read.
  if (message.recipientId !== process.env.RECIPIENT_USER_ID) {
    return;
  }

  console.log("RECIPIENT GOT MESSAGE:", message.text);

  socket.emit(
    "chat:read",
    {
      conversationId: message.conversationId,
      messageIds: [message._id],
    },
    (response) => {
      console.log("READ ACK:", response);
    },
  );
});

socket.on("connect_error", (err) => {
  console.error("RECIPIENT CONNECTION ERROR:", err.message);
});

socket.on("disconnect", (reason) => {
  console.log("RECIPIENT DISCONNECTED:", reason);
});
