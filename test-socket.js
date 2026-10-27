import { io } from "socket.io-client";
import { randomUUID } from "node:crypto";

const token = process.env.TEST_JWT_TOKEN?.trim();
const conversationId = process.env.TEST_CONVERSATION_ID;

if (!token || !conversationId) {
  console.error(
    "TEST_JWT_TOKEN or TEST_CONVERSATION_ID environment variable missing",
  );
  process.exit(1);
}
console.log("Starting Socket.IO test...");
console.log("Token present:", Boolean(token));
console.log("Conversation ID:", conversationId);

const socket = io("http://127.0.0.1:9090", {
  path: "/socket.io",
  transports: ["websocket"],
  extraHeaders: {
    Cookie: `token=${token}`,
  },
  timeout: 10000,
  reconnection: false,
});

socket.on("connect", () => {
  console.log("Connected:", socket.id);

  let count = 0;

  const interval = setInterval(() => {
    count++;

    const payload = {
      conversationId: process.env.TEST_CONVERSATION_ID,
      clientMessageId: `rate-test-${Date.now()}-${count}`,
      text: `Rate limit test message ${count}`,
    };

    socket.emit("chat:send", payload, (response) => {
      console.log(`Message ${count} response:`, response);
    });

    if (count === 11) {
      clearInterval(interval);
    }
  }, 500);
});

socket.on("chat:message", (message) => {
  console.log("MESSAGE EVENT:", message);
});

socket.on("chat:read_receipt", (receipt) => {
  console.log("READ RECEIPT RECEIVED:", receipt);
});

socket.on("connect_error", (err) => {
  console.log("CONNECTION ERROR:", err.message);
  console.log("Details:", err.description ?? "No additional details");
});

// socket.on("disconnect", (reason) => {
//   console.log("DISCONNECTED:", reason);
// });
