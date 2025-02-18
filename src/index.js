const express = require("express");
const admin = require("firebase-admin");
const serviceAccount = require("./stage-keys.json");
const assetRoutes = require("./routes/assets");
const pointsRoutes = require("./routes/points");
const challenges = require("./routes/challenges");
const leagueRoutes = require("./routes/league");
const leagueStatsRoutes = require("./routes/league/stats");
const userRoutes = require("./routes/users");
const buildingRoutes = require("./routes/buildings");
const challengeRoutes = require("./routes/challenges");
const coinsRequestsRoutes = require("./routes/coins-requests");
const disasterRoutes = require("./routes/disasters");
const notificationsRoutes = require("./routes/notifications");
const chatRoutes = require("./routes/chat");
const cors = require("cors");
const { Server } = require("socket.io");
const { createChallenge } = require("./routes/challenges");
const cron = require("node-cron");
const http = require("http");

const checkAuth = require("./middleware/authentication");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const port = process.env.PORT || 4000;

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
// Middleware to log request method and URL
app.use((req, res, next) => {
  console.warn(
    `👉🏻 Request Method: ${req.method}, Request URL: ${req.originalUrl} 👈🏻`
  );
  next();
});

app.get("/", (req, res) => {
  res.send("Welcome to the Firebase Authentication and Post Management!");
});

// Register new user
app.post("/register", async (req, res) => {
  const { userName, email, password } = req.body;

  if (!userName || !email || !password) {
    return res.status(400).json({
      message: "Username, email and password are required",
      success: false,
    });
  }

  try {
    // Create a new user in Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    console.log("Successfully created user:", userRecord.uid);

    // Add user profile to Firestore in the userProfiles collection
    await admin.firestore().collection("userProfiles").doc(userRecord.uid).set({
      userID: userRecord.uid,
      userName,
      email,
      gameInitMap: "",
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json({
      message: "User registered and profile created successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error creating user or profile:", error);
    return res.status(500).json({ message: error.message, success: false });
  }
});

// Log in a user
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(500)
      .json({ message: "Email and password are required", success: false });
  }

  admin
    .auth()
    .getUserByEmail(email)
    .then((userRecord) => {
      if (password === userRecord.providerData[0].providerId) {
        req.session.user = userRecord.uid;
        return res.json({
          message: "User Login successful",
          success: true,
        });
      } else {
        return res
          .status(401)
          .json({ message: "Login failed", success: false });
      }
    })
    .catch((error) => {
      console.error("Error getting user:", error);
      if (error.code === "auth/user-not-found") {
        res.status(404).json({
          message: "User doesn't exist. Please register first",
          success: false,
        });
      } else {
        res.status(401).json({ message: "Login failed", success: false });
      }
    });
});

app.get("/user-details", checkAuth, async (req, res) => {
  try {
    const user = req.user;
    const userPointsRef = admin
      .firestore()
      .collection("userPoints")
      .doc(user.user_id);

    const userPointsDoc = await userPointsRef.get();

    // for single user
    if (!userPointsDoc.exists) {
      await userPointsRef.set({
        coins: 25000,
        ecoPoints: 100,
        electricity: 200,
        garbage: 0,
        population: 0,
        userId: user.user_id,
        water: 1000,
      });
    }
    await admin
      .firestore()
      .collection("userProfiles")
      .doc(user.user_id)
      .get()
      .then((doc) => {
        res.status(200).json({
          user_id: doc.data().userID,
          email: doc.data().email,
          userName: doc.data().userName,
          gameInitMap: doc.data()?.gameInitMap,
        });
      })
      .catch((error) => {
        console.error("Error getting user:", error);
        if (error.code === "auth/user-not-found") {
          res.status(404).json({
            message: "User doesn't exist. Please register first",
            success: false,
          });
        } else {
          res.status(401).json({ message: "Login failed", success: false });
        }
      });
  } catch (error) {
    console.log("first error", error);
    res.status(500).json({ message: error.message, success: false });
  }
});
// Log out a user from the session
app.get("/logout", (req, res) => {
  req.session.user = null;
  res.json({ message: "Logged out", success: true });
});

app.use("/api", assetRoutes);
app.use("/v1", challenges);
app.use("/api/points", pointsRoutes);
app.use("/api/league-stats", leagueStatsRoutes); // Get league stats for resuming the league Game against a user.
app.use("/api/leagues", leagueRoutes);
app.use("/api/users", userRoutes);
app.use("/api/buildings", buildingRoutes);
app.use("/api/challenges", challengeRoutes);
app.use("/api/coins-requests", coinsRequestsRoutes);
app.use("/api/disasters", disasterRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/chat", chatRoutes);

app.get("/update-coins", async (req, res) => {
  try {
    const coinsCount = !!req.query.coins ? parseInt(req.query.coins, 10) : null;

    const userPointsSnapshot = await admin
      .firestore()
      .collection("userPoints")
      .get();
    const batch = admin.firestore().batch();

    userPointsSnapshot.forEach((doc) => {
      const userPointsRef = admin
        .firestore()
        .collection("userPoints")
        .doc(doc.id);
      batch.update(userPointsRef, { coins: coinsCount || 25000 });
    });

    await batch.commit();
    res
      .status(200)
      .json({ message: "Coins updated to 25000 for all users", success: true });
  } catch (error) {
    console.error("Error updating coins:", error);
    res.status(500).json({ message: error.message, success: false });
  }
});
// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Join room based on leagueID
  socket.on("joinLeague", (leagueID) => {
    console.log("leagueID", leagueID);
    socket.join(leagueID);
    console.log(`User ${socket.id} joined league ${leagueID}`);
  });

  // Handle message sending
  socket.on("sendMessage", async (data) => {
    console.log("Message received:", typeof data);
    let parsedData;
    try {
      parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (error) {
      console.error("Error parsing message data:", error);
      return socket.emit("error", "Invalid message format");
    }

    const { leagueID, message, userID } = parsedData;
    console.log("leagueID", leagueID, "message", message, "userID: >>", userID);

    try {
      if (leagueID || message || userID) {
        // Get user details for sender name
        const userDoc = await admin
          .firestore()
          .collection("userProfiles")
          .doc(userID)
          .get();
        if (!userDoc.exists) {
          console.error("Missing userID in the received data:", parsedData);
          return socket.emit("error", "User not found");
        }

        const senderName = userDoc.data().userName || "Anonymous";

        // Create message document
        const messageDoc = {
          senderId: userID,
          senderName,
          message,
          timestamp: new Date().toISOString(),
        };

        await admin
          .firestore()
          .collection("leagueChats")
          .doc(leagueID)
          .collection("messages")
          .add(messageDoc);

        // Broadcast message to the league room
        console.log("Emitting message to league room:", leagueID);
        io.to(leagueID).emit(leagueID, messageDoc);
      }
    } catch (error) {
      console.error("Error handling sendMessage:", error);
      socket.emit("error", "Failed to send message");
    }
  });

  // Handle user disconnection
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});

// Create a new asset with additional data (requires authentication)
app.post("/buildings/new", checkAuth, (req, res) => {
  const { buildingId, isCreated, isForbidden, isDestroyed, isRotate, x, y } =
    req.body;

  const db = admin.firestore();
  const buildingRef = db.collection("buildings").doc();

  const data = {
    createdAt: new Date().toISOString(),
  };
  // for optional data
  if (buildingId !== undefined) data.buildingId = buildingId;
  if (isCreated !== undefined) data.isCreated = isCreated;
  if (isForbidden !== undefined) data.isForbidden = isForbidden;
  if (isRotate !== undefined) data.isRotate = isRotate;
  if (isDestroyed !== undefined) data.isDestroyed = isDestroyed;
  if (x !== undefined) data.x = x;
  if (y !== undefined) data.y = y;

  buildingRef
    .set(data)
    .then(() => {
      return res.json({ message: "Asset created", success: true });
    })
    .catch((error) => {
      console.error("Error creating asset:", error);
      return res.status(500).json({ message: error.message, success: false });
    });
});

// Function to call the /challenges/random-disaster endpoint
// async function callRandomDisasterEndpoint() {
//   try {
//     const response = await axios.get(
//       "http://localhost:4000/challenges/random-disaster"
//     );
//     console.log("Random disaster triggered:", response.data);
//   } catch (error) {
//     console.error("Error triggering random disaster:", error);
//   }
// }

// Schedule the function to run on a random day of the week at a specific time
// const cronExpression = `0 0 * * ${randomDay}`; // At 00:00 (midnight) on the random day of the week

// Schedule the function to run 2-3 times a day at random times
const scheduleRandomChallenge = () => {
  const times = [];
  const numTimes = Math.floor(Math.random() * 2) + 2; // 2 or 3 times a day

  for (let i = 0; i < numTimes; i++) {
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random() * 60);
    times.push({ hour, minute });
  }

  times.forEach((time) => {
    const cronExpression = `${time.minute} ${time.hour} * * *`;
    cron.schedule(cronExpression, () => {
      console.log(`Scheduled task running at ${time.hour}:${time.minute}...`);
      createChallenge();
    });
  });
};

const runDailyCronJob = () => {
  cron.schedule(
    "0 3 * * *",
    async () => {
      console.log("Running daily cron job at 3 AM UK time...");

      try {
        const usersSnapshot = await admin
          .firestore()
          .collection("userAssets")
          .get();

        const noOfDays = 1; // Replace with actual number of days
        const data = [];

        const userAssets = usersSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        for (const userAsset of userAssets) {
          console.log("first userAsset", userAsset);
          const calculatedPoints = await calculateUserPoints(
            userAsset.userId,
            userAsset.buildingId,
            userAsset?.leagueId,
            noOfDays
          );
          data.push(calculatedPoints);
        }

        console.log("Calculated points data:", data);
      } catch (error) {
        console.error("Error running daily cron job:", error);
      }
    },
    {
      timezone: "Europe/London",
    }
  );
};

runDailyCronJob();
scheduleRandomChallenge();

// Start the server
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const calculateUserPoints = async (userId, buildingId, leagueId, noOfDays) => {
  try {
    const increaseStats = noOfDays;
    // If noOfDays is not provided, set it to 1
    noOfDays = noOfDays || 1;

    // Fetch building document
    const buildingDoc = await admin
      .firestore()
      .collection("buildings")
      .doc(`${buildingId}`)
      .get();
    const buildData = buildingDoc.data();

    let pointsData;

    const calculateEmploymentEarnings = (
      currentPopulation,
      buildingData,
      noOfDays
    ) => {
      if (!buildingData.effect) return 0;
      return (
        Math.min(currentPopulation, buildingData.jobCapacity || 0) *
        buildingData.effect *
        noOfDays
      );
    };

    if (!leagueId) {
      const userDocRef = admin.firestore().collection("userPoints").doc(userId);
      const userDoc = await userDocRef.get();
      if (!userDoc?.exists) {
        console.error("User document not found");
        return;
      }
      const userPoints = userDoc.data();

      let ecoPoints =
        (userPoints.ecoPoints || 0) + (buildData?.ecoEarning || 0) * noOfDays;

      if (buildData.id === 1) {
        ecoPoints -= Math.floor(Math.random() * 11) + 5; // Subtract random value between 5 and 15
      } else {
        // ecoPoints -= (buildData?.ecoPoints || 0) * noOfDays;
      }

      const employmentEarnings = calculateEmploymentEarnings(
        userPoints.population || 0,
        buildData,
        noOfDays
      );

      console.log("Employment Earnings: >>", employmentEarnings);

      const coinCalculation = increaseStats
        ? (buildData?.earning || 0) * noOfDays +
          employmentEarnings +
          (userPoints?.coins -
            buildData?.taxIncome *
              noOfDays *
              (buildData?.residentCapacity || 0) -
            (buildData?.maintenanceCost || 0) * noOfDays)
        : userPoints?.coins -
          (buildData?.cost +
            buildData?.taxIncome * (buildData?.residentCapacity || 0));
      console.log("Coin Calculation: >>", coinCalculation);

      pointsData = {
        coins: coinCalculation,
        ecoPoints,
        electricity:
          (userPoints.electricity || 0) +
          (buildData?.eleEarning || 0) * noOfDays -
          buildData.electricityConsumption * noOfDays,
        garbage:
          userPoints.garbage +
          (buildData?.wasteProduce || 0) * noOfDays -
          (buildData?.wasteRemoval || 0) * noOfDays,
        water:
          (userPoints.water || 0) +
          (buildData?.waterEarning || 0) * noOfDays -
          buildData.waterUsage * noOfDays,
      };

      if (!increaseStats) {
        pointsData.population =
          userPoints.population + buildData?.residentCapacity * noOfDays;
      }

      await userDocRef.update(pointsData);
    } else {
      const leagueStatsRef = admin.firestore().collection("leagueStats");
      const leagueStatsDoc = await leagueStatsRef
        .where("leagueId", "==", leagueId)
        .where("userId", "==", userId)
        .limit(1)
        .get();

      if (leagueStatsDoc.empty) {
        console.error("League stats document not found");
        return;
      }

      const leagueStats = leagueStatsDoc.docs[0].data();
      console.log(leagueStats.ecoPoints, "buildData", buildData);

      let ecoPoints =
        (leagueStats.ecoPoints || 0) + (buildData?.ecoEarning || 0) * noOfDays;

      if (buildData.id === 1) {
        ecoPoints -= Math.floor(Math.random() * 11) + 5; // Subtract random value between 5 and 15
      } else {
        ecoPoints -= (buildData?.ecoPoints || 0) * noOfDays;
      }

      const employmentEarnings = calculateEmploymentEarnings(
        leagueStats.population || 0,
        buildData,
        noOfDays
      );

      console.log("Employment Earnings: >>", employmentEarnings);

      const coinCalculation = increaseStats
        ? (buildData?.earning || 0) * noOfDays +
          employmentEarnings +
          (leagueStats?.coins - buildData?.taxIncome * noOfDays)
        : leagueStats?.coins - (buildData.cost + buildData?.taxIncome);

      pointsData = {
        coins: coinCalculation,
        ecoPoints,
        electricity:
          leagueStats.electricity +
          (buildData?.eleEarning || 0) * noOfDays -
          buildData.electricityConsumption * noOfDays,
        garbage:
          leagueStats.garbage +
          (buildData?.wasteProduce || 0) * noOfDays -
          (buildData?.wasteRemoval || 0) * noOfDays,
        water:
          leagueStats.water +
          (buildData?.waterEarning || 0) * noOfDays -
          buildData.waterUsage * noOfDays,
      };

      if (!increaseStats) {
        pointsData.population =
          leagueStats.population + buildData?.residentCapacity * noOfDays;
      }

      await leagueStatsDoc.docs[0].ref.update(pointsData);
    }
    return pointsData;
  } catch (error) {
    console.error("Error calculating user points:", error);
  }
};
