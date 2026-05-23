import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import db from "./db.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());

const server = createServer(app);

const socketRoomMap = {};

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.get("/messages/:roomCode", async (req, res) => {
  const { roomCode } = req.params;
  try {
    const [result] = await db.query(
      "SELECT * FROM syncupchat WHERE roomCode = ? ORDER BY chatId ASC",
      [roomCode],
    );
    res.json(result);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post("/createRoom", async (req, res) => {
  try {
    const { roomCode, roomName, createdBy } = req.body;

    await db.query(
      `INSERT INTO Rooms(roomCode, roomName, createdAt,createdBy)
       VALUES (?, ?, NOW(),?)`,
      [roomCode, roomName, createdBy],
    );

    res.status(201).json({
      success: true,
      message: "Room created successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to create room",
    });
  }
});

app.get("/room/:roomCode", async (req, res) => {
  const { roomCode, createdBy } = req.params;

  const [rows] = await db.query(
    "SELECT roomName, createdAt,createdBy FROM Rooms WHERE roomCode=?",
    [roomCode],
  );

  if (rows.length === 0) {
    return res.status(404).json({
      message: "Room not found",
    });
  }

  res.json(rows[0]);
});

app.get("/room/members/:roomCode", async (req, res) => {
  const { roomCode } = req.params;

  const [rows] = await db.query(
    "SELECT username FROM RoomMembers WHERE roomCode = ?",
    [roomCode],
  );

  const members = rows.map((row) => row.username);

  res.json({
    members,
  });
});

io.on("connection", (socket) => {
  socket.on("join_room", async (data) => {
    const { roomCode, username } = data;
    socket.join(roomCode);
    socketRoomMap[socket.id] = { roomCode, username };

    await db.query(
      `INSERT INTO RoomMembers (roomCode, username)
       SELECT ?, ? FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM RoomMembers WHERE roomCode = ? AND username = ?
       )`,
      [roomCode, username, roomCode, username],
    );

    const members = Object.values(socketRoomMap)
      .filter((s) => s.roomCode === roomCode)
      .map((s) => s.username);

    io.to(roomCode).emit("room_members_update", members);

    socket.to(roomCode).emit("system_message", {
      message: `${username} has joined the chat.`,
      sentBy: "System",
      sentAt: new Date(),
    });
  });

  socket.on("send_message", async (data) => {
    const { roomCode, message, sentBy, socketId, sentAt } = data;
    const sql =
      "INSERT INTO syncupchat (socketId, message, sentBy, roomCode,sentAt) VALUES (?,?,?,?,NOW())";

    try {
      const [result] = await db.query(sql, [
        socketId,
        message,
        sentBy,
        roomCode,
      ]);

      const newMessage = {
        chatId: result.insertId,
        socketId: socketId,
        message: message,
        sentBy: sentBy,
        roomCode: roomCode,
        sentAt: data.sentAt || new Date(),
      };

      io.to(roomCode).emit("receive_message", newMessage);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("disconnect", () => {
    const info = socketRoomMap[socket.id];
    if (!info) return;

    const { roomCode } = info;
    delete socketRoomMap[socket.id];

    // emit updated list after someone leaves
    const remaining = Object.values(socketRoomMap)
      .filter((s) => s.roomCode === roomCode)
      .map((s) => s.username);

    io.to(roomCode).emit("room_members_update", remaining);
  });

  socket.on("leave_room", ({ roomCode, username }) => {
    socket.leave(roomCode);
    delete socketRoomMap[socket.id];

    const remaining = Object.values(socketRoomMap)
      .filter((s) => s.roomCode === roomCode)
      .map((s) => s.username);

    io.to(roomCode).emit("room_members_update", remaining);

    socket.to(roomCode).emit("system_message", {
      message: `${username} has left the chat.`,
      sentBy: "System",
      sentAt: new Date(),
    });
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log("Server started ", PORT);
});
