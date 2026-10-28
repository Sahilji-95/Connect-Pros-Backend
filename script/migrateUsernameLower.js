import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/user.model.js";

async function migrateUsernameLower() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const cursor = User.find({
      usernameLower: { $exists: false },
    })
      .select("_id username")
      .lean()
      .cursor();

    let operations = [];
    let migrated = 0;

    for await (const user of cursor) {
      operations.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              usernameLower: user.username.trim().toLowerCase(),
            },
          },
        },
      });

      if (operations.length === 500) {
        const result = await User.bulkWrite(operations, {
          ordered: false,
        });

        migrated += result.modifiedCount;
        operations = [];
      }
    }

    if (operations.length > 0) {
      const result = await User.bulkWrite(operations, {
        ordered: false,
      });

      migrated += result.modifiedCount;
    }

    await User.collection.createIndex({
      usernameLower: 1,
      _id: 1,
    });

    console.log(`Username migration complete: ${migrated} users updated.`);
  } catch (error) {
    console.error("Username migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

migrateUsernameLower();
