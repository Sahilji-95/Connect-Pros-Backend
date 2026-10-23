import Post from "../models/post.model.js";
import User from "../models/user.model.js";
import Comment from "../models/comment.model.js";
import cloudinary from "../config/cloudinary.js";

export const activeCheck = async (req, res) => {
  return res.status(200).json({ message: "RUNNING" });
};

//CREATE NEW POST
export const createNewPost = async (req, res) => {
  try {
    const userId = req.user._id;

    let media = "";
    let mediaPublicId = "";
    let fileType = "image";

    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "linkedin/posts",
            resource_type: "image",
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          },
        );

        stream.end(req.file.buffer);
      });

      media = result.secure_url;
      mediaPublicId = result.public_id;
      fileType = result.resource_type;
    }

    const post = new Post({
      userId,
      body: req.body.body,
      media,
      mediaPublicId,
      fileType,
    });

    await post.save();

    await post.populate("userId", "name username email profilePicture");

    return res.status(201).json({
      success: true,
      message: "Post created",
      post: {
        ...post.toObject(),
        isLiked: false,
      },
    });
  } catch (error) {
    console.error("Create post error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

//GET ALL POST
export const getAllPost = async (req, res) => {
  try {
    const userId = req.user._id;

    const posts = await Post.find().populate(
      "userId",
      "name username email profilePicture",
    );

    const updatedPosts = posts.map((post) => {
      const postObject = post.toObject();

      const isLiked = (post.likedBy || []).some(
        (id) => id.toString() === userId.toString(),
      );

      return {
        ...postObject,
        likes: post.likes ?? 0,
        isLiked,
      };
    });

    return res.status(200).json({
      posts: updatedPosts,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

//DELETE POST
export const deletePost = async (req, res) => {
  const { post_id } = req.body;

  try {
    const userId = req.user._id;

    if (!post_id) {
      return res.status(400).json({
        success: false,
        message: "Post ID is required",
      });
    }

    const post = await Post.findById(post_id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
      });
    }

    if (post.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to delete this post",
      });
    }

    if (post.mediaPublicId) {
      await cloudinary.uploader.destroy(post.mediaPublicId, {
        resource_type: "image",
      });
    }

    await post.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Post deleted",
      post_id: post._id,
    });
  } catch (error) {
    console.error("Delete post error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete post",
    });
  }
};

//NEW COMMENT
export const commentPost = async (req, res) => {
  const { post_id, comment: commentText } = req.body;

  try {
    const userId = req.user._id;

    if (!post_id || !commentText?.trim()) {
      return res.status(400).json({
        message: "Post ID and comment are required",
      });
    }

    const post = await Post.findById(post_id);

    if (!post) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    const comment = new Comment({
      userId,
      postId: post_id,
      body: commentText.trim(),
    });

    await comment.save();

    return res.status(201).json({
      message: "Comment posted",
      comment,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

//GET COMMENT
export const getComment = async (req, res) => {
  const { post_id } = req.query;

  try {
    const post = await Post.findById(post_id);

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const comments = await Comment.find({ postId: post_id })
      .populate("userId", "name username")
      .sort({ createdAt: -1 });

    return res.status(200).json(comments);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

//DELETE COMMENT
export const deleteComment = async (req, res) => {
  const { comment_id } = req.body;

  try {
    const userId = req.user._id;

    if (!comment_id) {
      return res.status(400).json({
        message: "Comment ID is required",
      });
    }

    const comment = await Comment.findById(comment_id);

    if (!comment) {
      return res.status(404).json({
        message: "Comment not found",
      });
    }

    if (comment.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        message: "Unauthorized to delete this comment",
      });
    }

    await comment.deleteOne();

    return res.status(200).json({
      message: "Comment deleted",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

//LIKE INCREMENT
export const increment_likes = async (req, res) => {
  try {
    const { post_id } = req.body;
    const userId = req.user._id;

    if (!post_id) {
      return res.status(400).json({
        message: "Post ID is required",
      });
    }

    const post = await Post.findById(post_id);

    if (!post) {
      return res.status(404).json({
        message: "Post not found",
      });
    }

    const alreadyLiked = (post.likedBy || []).some(
      (id) => id.toString() === userId.toString(),
    );

    if (alreadyLiked) {
      post.likedBy.pull(userId);
      post.likes = Math.max(0, (post.likes || 0) - 1);
    } else {
      post.likedBy.push(userId);
      post.likes = (post.likes || 0) + 1;
    }

    await post.save();

    return res.status(200).json({
      message: alreadyLiked ? "Post unliked" : "Post liked",
      likes: post.likes,
      isLiked: !alreadyLiked,
      post_id: post._id,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

//GET POST FOR USER
export const getPostsByUsername = async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({
      username: username,
      active: true,
    }).select("_id");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const posts = await Post.find({
      userId: user._id,
      active: true,
    })
      .populate("userId", "name username profilePicture")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      posts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
