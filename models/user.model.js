import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  profilePicture: {
    type: String,
    default:
      "https://res.cloudinary.com/dodj3pvt4/image/upload/v1792695130/linkedin/posts/tm9kvghsbw7xoez27vex.png",
  },
  createdAt: {
    type: Date,
    deafult: Date.now,
  },
  token: {
    type: String,
    deafult: "",
  },
});

const User = mongoose.model("User", UserSchema);
export default User;
