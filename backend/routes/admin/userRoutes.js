const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getUsers,
  getProfilePeople,
  getUser,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  getUserProfile,
  updateUserProfile,
} = require("../../controllers/admin/userController");

const { protect, allow } = require("../../middleware/adminAuth");

// Every route below is authenticated and role-gated. There is no unguarded
// :id handler on this router.
router.use(protect, allow("owner", "admin"));

router
  .route("/")
  .get(getUsers)
  .post(createUser);

// Before /:id, which would otherwise take "profiles" as an id.
router.get("/profiles", getProfilePeople);

router
  .route("/:id")
  .get(getUser)
  .put(updateUser)
  .delete(allow("owner"), deleteUser);

router.put("/:id/password", resetUserPassword);
router.route("/:id/profile").get(getUserProfile).put(updateUserProfile);

module.exports = router;
