import { Router } from "express";
import {
  activeCheck,
  createNewPost,
  getAllPost,
  deletePost,
  commentPost,
  getComment,
  deleteComment,
  increment_likes,
  getPostsByUsername,
} from "../controllers/post.controller.js";

import { authMiddleware } from "../middleware/auth.js";
import multer from "multer";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  },
});
// Public health check
router.route("/").get(activeCheck);

router
  .route("/post/create_post")
  .post(authMiddleware, upload.single("media"), createNewPost);

router.route("/post/get_post").get(authMiddleware, getAllPost);

router.route("/post/delete_post").delete(authMiddleware, deletePost);

router.route("/post/like").post(authMiddleware, increment_likes);

router
  .route("/post/username/:username")
  .get(authMiddleware, getPostsByUsername);

router.route("/comment/create_comment").post(authMiddleware, commentPost);

router.route("/comment/get_comment").get(authMiddleware, getComment);

router.route("/comment/delete_comment").delete(authMiddleware, deleteComment);

export default router;
