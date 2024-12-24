const express = require("express");
const admin = require("firebase-admin");
const checkAuth = require("../../middleware/authentication");
const createResponse = require("../../utils/helper-functions");

const router = express.Router();

const challenges = [
  {
    id: 1,
    description: "Build 4 Residential houses",
    progress: "1/4",
    reward: 200,
  },
  { id: 2, description: "Build a Factory", progress: "0/1", reward: 200 },
  { id: 3, description: "Build a School", progress: "0/1", reward: 200 },
  { id: 4, description: "Build a Hospital", progress: "0/1", reward: 200 },
  { id: 5, description: "Build two Windmills", progress: "0/2", reward: 200 },
];

router.get("/random-challenge", checkAuth, (req, res) => {
  const randomIndex = Math.floor(Math.random() * challenges.length);
  const randomChallenge = challenges[randomIndex];
  res.json(
    createResponse(
      200,
      "Random challenge fetched successfully",
      randomChallenge
    )
  );
});

router.post("/create-challenge", checkAuth, async (req, res) => {
  const { startTime, endTime, leagueID, message, required, points } = req.body;

  if (
    !startTime ||
    !endTime ||
    !message ||
    !required ||
    typeof required !== "object" ||
    !required.buildingID ||
    !required.count ||
    !points
  ) {
    return res
      .status(400)
      .json(createResponse(false, "All fields are required"));
  }

  const newChallenge = {
    startTime,
    endTime,
    leagueID: leagueID || null,
    message,
    required,
    points,
    isEnded: false,
  };

  try {
    if (leagueID) {
      const leagueRef = admin.firestore().collection("leagues").doc(leagueID);
      const leagueDoc = await leagueRef.get();
      if (!leagueDoc.exists) {
        return res
          .status(404)
          .json(
            createResponse(false, `No league found for the id: ${leagueID}`)
          );
      }
    }

    const buildingRef = admin
      .firestore()
      .collection("buildings")
      .doc(required.buildingID);
    const buildingDoc = await buildingRef.get();
    if (!buildingDoc.exists) {
      return res
        .status(404)
        .json(
          createResponse(
            false,
            `No building found for the id: ${required.buildingID}`
          )
        );
    }

    const challengeRef = await admin
      .firestore()
      .collection("challenges")
      .add(newChallenge);

    // Create the notification document
    const notificationDoc = {
      message:
        "New eco challenge! Complete the challenge to get 200 coins reward",
      notificationType: "challenge",
      isGlobal: true,
      userID: null,
    };
    await admin.firestore().collection("notifications").add(notificationDoc);

    res.json(
      createResponse(true, "Challenge created successfully", {
        id: challengeRef.id,
      })
    );
  } catch (error) {
    console.error("Error creating challenge:", error);
    res
      .status(500)
      .json(createResponse(false, "An error occurred", error.message));
  }
});

// router.post("/test-building-creation", checkAuth, async (req, res) => {
//   const { buildingID, userID, leagueID } = req.body;

//   if (!buildingID || !userID) {
//     return res
//       .status(400)
//       .json(createResponse(false, "buildingID and userID are required"));
//   }

//   try {
//     await handleBuildingCreation(buildingID, userID, leagueID);
//     res.json(createResponse(true, "Building creation handled successfully"));
//   } catch (error) {
//     console.error("Error handling building creation:", error);
//     res
//       .status(500)
//       .json(createResponse(false, "An error occurred", error.message));
//   }
// });

router.post("/create-challenge-progress", checkAuth, async (req, res) => {
  const { challengeID, userID, buildingID, count } = req.body;

  if (!challengeID || !userID || !buildingID || !count) {
    return res
      .status(400)
      .json(createResponse(false, "All fields are required"));
  }

  const challengeProgress = {
    challengeID,
    userID,
    progress: {
      buildingID,
      count,
    },
    isCompleted: false,
  };

  try {
    const challengeRef = admin
      .firestore()
      .collection("challenges")
      .doc(challengeID);
    const challengeDoc = await challengeRef.get();
    if (!challengeDoc.exists) {
      return res
        .status(404)
        .json(
          createResponse(false, `No challenge found for the id: ${challengeID}`)
        );
    }

    await admin
      .firestore()
      .collection("challengeProgress")
      .add(challengeProgress);
    res.json(createResponse(true, "Challenge progress created successfully"));
  } catch (error) {
    console.error("Error creating challenge progress:", error);
    res
      .status(500)
      .json(createResponse(false, "An error occurred", error.message));
  }
});

router.get("/active-challenges", checkAuth, async (req, res) => {
  try {
    const now = new Date();
    const activeChallengesSnapshot = await admin
      .firestore()
      .collection("challenges")
      .where("isEnded", "==", false)
      .get();

    const activeChallenges = activeChallengesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(
      createResponse(
        true,
        "Active challenges fetched successfully",
        activeChallenges
      )
    );
  } catch (error) {
    console.error("Error fetching active challenges:", error);
    res
      .status(500)
      .json(createResponse(false, "An error occurred", error.message));
  }
});

router.get("/completed-challenges", checkAuth, async (req, res) => {
  const userID = req.user.user_id;
  const { leagueID } = req.query;

  try {
    let query = admin
      .firestore()
      .collection("challengeProgress")
      .where("userID", "==", userID)
      .where("isCompleted", "==", true);

    if (leagueID) {
      query = query.where("leagueID", "==", leagueID);
    } else {
      query = query.where("leagueID", "==", null);
    }

    const completedChallengesSnapshot = await query.get();
    const completedChallenges = completedChallengesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(
      createResponse(
        true,
        "Completed challenges fetched successfully",
        completedChallenges
      )
    );
  } catch (error) {
    console.error("Error fetching completed challenges:", error);
    res
      .status(500)
      .json(createResponse(false, "An error occurred", error.message));
  }
});

module.exports = router;
