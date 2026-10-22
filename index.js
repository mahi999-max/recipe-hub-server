import express from 'express';
import cors from 'cors';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken'

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json())
const port = 5000
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://recipe-hub-f35f.vercel.app",
    "https://recipe-hub-f35f-git-main-mahi999-maxs-projects.vercel.app",
  ],
  credentials: true,
}));


const client = new MongoClient(process.env.MONGO_URI);
async function run() {
    try {
        const database = client.db("Recipe_Hub");
        const foodCollection = database.collection("allFoods");
        const userCollections = database.collection("user")
        const reportsCollection = database.collection('reports')
        const likesCollection = database.collection('likes')
        const orderCollection = database.collection('orders')
        await likesCollection.createIndex(
            { foodId: 1, userId: 1 },
            { unique: true }
        );


        // ১. JWT Middleware
        const verifyToken = (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader?.startsWith("Bearer ")) {
                return res.status(401).json({ message: "Unauthorized access: No token provided" });
            }

            try {
                const token = authHeader.split(" ")[1];
                req.user = jwt.verify(token, process.env.JWT_SECRET);
                next();
            } catch (error) {
    console.log("JWT error:", error.message, "| secret loaded:", !!process.env.JWT_SECRET);
    return res.status(403).json({ message: "Forbidden: Invalid token" });
}
        };

        // role সরাসরি DB থেকে দেখা হয়
        const verifyAdmin = async (req, res, next) => {
            const dbUser = await userCollections.findOne({ email: req.user.email });
            if (dbUser?.role !== "admin") {
                return res.status(403).json({ message: "Forbidden: Admin only" });
            }
            next();
        };

        // ২. Protected Route


        app.post('/api/allFoods', async (req, res) => {
            const food = req.body
            const result = await foodCollection.insertOne(food)
            res.send(result)
        })


        app.get('/api/allFoods/:id', async (req, res) => {
            const id = req.params.id
            const result = await foodCollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })

        app.get("/api/myfood/:id", verifyToken, async (req, res) => {
            const userId = req.params.id;
            console.log("Requested ID:", userId);
            const result = await foodCollection
                .find({ userId: userId })
                .toArray();
            console.log("Found recipes:", result.length);


            res.send(result);
        });

        app.get("/api/allFoods", async (req, res) => {
            try {
                const foods = await foodCollection.find({}).toArray();
                res.status(200).json(foods);
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Failed to fetch foods" });
            }
        });

        app.patch('/api/allFoods/:id', async (req, res) => {
            const id = req.params.id
            const { isfeatured } = req.body
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    isfeatured: isfeatured
                }
            }
            const result = await foodCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.post('/api/allFoods/likes', async (req, res) => {
            try {
                const { foodId, userId } = req.body;

                if (!foodId || !userId) {
                    return res.status(400).send({
                        message: 'foodId and userId are required'
                    });
                }

                if (!ObjectId.isValid(foodId)) {
                    return res.status(400).send({
                        message: 'Invalid foodId'
                    });
                }

                const foodObjectId = new ObjectId(foodId);

                const existingLike = await likesCollection.findOne({
                    foodId: foodObjectId,
                    userId: String(userId)
                });

                // Already liked: Unlike
                if (existingLike) {
                    await likesCollection.deleteOne({
                        _id: existingLike._id
                    });

                    await foodCollection.updateOne(
                        { _id: foodObjectId },
                        { $inc: { likeCount: -1 } }
                    );

                    return res.send({
                        success: true,
                        isLiked: false,
                        message: 'Recipe unliked successfully'
                    });
                }

                // Not liked yet: Like
                await likesCollection.insertOne({
                    foodId: foodObjectId,
                    userId: String(userId),
                    date: new Date()
                });

                await foodCollection.updateOne(
                    { _id: foodObjectId },
                    { $inc: { likeCount: 1 } }
                );

                return res.send({
                    success: true,
                    isLiked: true,
                    message: 'Recipe liked successfully'
                });

            } catch (error) {
                console.error('Error toggling recipe like:', error);

                res.status(500).send({
                    message: 'Failed to update recipe like'
                });
            }
        });

        // ইউজারের লাইক করা রেসিপিগুলো পাওয়ার জন্য GET রুট (ড্যাশবোর্ডের জন্য)
        app.get('/api/allFoods/likes/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const userLikes = await likesCollection.find({ userId: String(userId) }).toArray();

        // foodId গুলোকে ObjectId তে কনভার্ট করুন
        const foodObjectIds = userLikes
            .map(item => {
                try {
                    return new ObjectId(item.foodId);
                } catch {
                    return item.foodId; // ObjectId তে কনভার্ট না হলে সাধারণ স্ট্রিং হিসেবে থাকবে
                }
            })
            .filter(Boolean);

        const likedRecipes = await foodCollection
            .find({ _id: { $in: foodObjectIds } })
            .toArray();

        res.send(likedRecipes);
    } catch (error) {
        console.error("Error fetching user liked recipes:", error);
        res.status(500).send({ error: "Failed to fetch liked recipes" });
    }
});

        app.delete('/api/allFoods/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await foodCollection.deleteOne(query)
            res.send(result)
        })

        app.get('/api/allUsers', verifyToken,verifyAdmin, async (req, res) => {
            try {
                const users = await userCollections.find({}).toArray();
                res.status(200).json(users);
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Failed to fetch user" });
            }
        })

        app.post('/api/reports', async (req, res) => {
            try {
                const { foodId, reason, email } = req.body;

                const reportDoc = {
                    foodId: new ObjectId(foodId),
                    userEmail: email, // ইউজার অথেন্টিকেশন থাকলে তার আইডি দিতে পারেন
                    reason,
                    time: new Date()
                };

                const result = await reportsCollection.insertOne(reportDoc);
                res.send(result);
            } catch (error) {
                console.error("Error saving report:", error);
                res.status(500).send({ error: "Failed to submit report" });
            }
        });



        app.delete('/api/reports/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await reportsCollection.deleteOne(query)
            res.send(result)
        })

        app.get('/api/reports', verifyToken,verifyAdmin, async (req, res) => {
            const report = await reportsCollection.find({}).toArray();
            res.json(report)
        })

        app.patch('/api/allUsers/:id/block', async (req, res) => {
            try {
                const { id } = req.params
                const { isBlocked } = req.body

                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({
                        success: false,
                        message: "Invalid user Id"
                    })
                }
                if (typeof isBlocked !== 'boolean') {
                    return res.status(400).send({
                        success: false,
                        message: 'isBlocked must be true or false'
                    })
                }
                const result = await userCollections.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isBlocked } }
                )
                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "User not found"
                    })
                }
                res.send({
                    success: true,
                    message: isBlocked ? "User bloked successfully" : "User unblocked successfully"
                })





            }
            catch (error) {
                console.log(error);
                res.status(500).send({
                    success: false,
                    message: "Internal server error"
                })
            }
        })

        app.patch('/api/users/make-premium/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const filter = { email: email };
                const updateDoc = {
                    $set: {
                        isPremium: true,
                        premiumSince: new Date()
                    }
                };
                const result = await userCollections.updateOne(filter, updateDoc);
                res.send(result);
            } catch (error) {
                console.error("Failed to update premium status:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        app.get("/api/user-status", async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) {
                    return res.status(400).json({ message: "Email is required" });
                }

                // Apnar database theke user khunje ber korun (Mongoose ba MongoDB driver onujayi)
                const dbUser = await User.findOne({ email: email });

                if (!dbUser) {
                    return res.status(404).json({ message: "User not found" });
                }

                // Database theke isPremium field pathiye dicchi
                res.status(200).json({
                    isPremium: dbUser.isPremium || false
                });
            } catch (error) {
                console.error("Error fetching user status:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });




        app.post("/api/orders/confirm", async (req, res) => {
            try {
                const { sessionId } = req.body;
                if (!sessionId) {
                    return res.status(400).send({ message: "sessionId required" });
                }

                // Stripe-কে সরাসরি জিজ্ঞেস করা হচ্ছে, client-এর কথা বিশ্বাস না করে
                const s = await stripe.checkout.sessions.retrieve(sessionId);

                if (s.payment_status !== "paid" || s.metadata?.type !== "recipe") {
                    return res.status(400).send({ message: "Payment not verified" });
                }

                // একই session দুইবার এলে duplicate order হবে না
                await orderCollection.updateOne(
                    { stripeSessionId: s.id },
                    {
                        $setOnInsert: {
                            stripeSessionId: s.id,
                            email: s.metadata.email,
                            foodId: s.metadata.foodId,
                            amount: s.amount_total / 100,
                            paidAt: new Date(),
                        },
                    },
                    { upsert: true }
                );

                res.send({ ok: true, foodId: s.metadata.foodId });
            } catch (error) {
                console.error("Order confirm error:", error);
                res.status(500).send({ message: "Server error" });
            }
        });


        app.get("/api/my-purchases",verifyToken, async (req, res) => {
            try {
                const email = req.user?.email;   // আগে ছিল: const { email } = req.query;
                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }

                // এই user-এর সব order, নতুন আগে
                const orders = await orderCollection
                    .find({ email })
                    .sort({ paidAt: -1 })
                    .toArray();

                // order-এর foodId (string) গুলোকে ObjectId বানিয়ে recipe গুলো একবারে আনা
                const foodIds = orders
                    .map((o) => o.foodId)
                    .filter((id) => ObjectId.isValid(id))
                    .map((id) => new ObjectId(id));

                const foods = await foodCollection
                    .find({ _id: { $in: foodIds } })
                    .toArray();

                // প্রতিটা order-এর সাথে তার recipe জুড়ে দেওয়া
                const purchases = orders
                    .map((order) => {
                        const food = foods.find((f) => String(f._id) === order.foodId);
                        if (!food) return null; // recipe পরে মুছে ফেলা হলে বাদ
                        return {
                            orderId: order._id,
                            amount: order.amount,
                            paidAt: order.paidAt,
                            food,
                        };
                    })
                    .filter(Boolean);

                res.send(purchases);
            } catch (error) {
                console.error("My purchases error:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // একটা নির্দিষ্ট recipe এই user কিনেছে কিনা (Purchased badge-এর জন্য কাজে লাগবে)
        app.get("/api/purchases/check", async (req, res) => {
            try {
                const { email, foodId } = req.query;
                if (!email || !foodId) {
                    return res.status(400).send({ message: "email and foodId required" });
                }
                const order = await orderCollection.findOne({ email, foodId });
                res.send({ purchased: !!order });
            } catch (error) {
                console.error("Purchase check error:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        app.get("/api/admin/transactions", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const orders = await orderCollection
            .find({})
            .sort({ paidAt: -1 })
            .toArray();

        const foodIds = orders
            .map((o) => o.foodId)
            .filter((id) => ObjectId.isValid(id))
            .map((id) => new ObjectId(id));

        const emails = [...new Set(orders.map((o) => o.email).filter(Boolean))];

        const [foods, users] = await Promise.all([
            foodCollection.find({ _id: { $in: foodIds } }).toArray(),
            userCollections.find({ email: { $in: emails } }).toArray(),
        ]);

        const transactions = orders.map((order) => {
            const food = foods.find((f) => String(f._id) === order.foodId);
            const user = users.find((u) => u.email === order.email);
            return {
                id: order._id,
                stripeSessionId: order.stripeSessionId,
                amount: order.amount,
                paidAt: order.paidAt,
                email: order.email,
                buyerName: user?.name || "Unknown",
                foodId: order.foodId,
                recipeTitle: food?.title || "Deleted recipe",
            };
        });

        res.send(transactions);
    } catch (error) {
        console.error("Admin transactions error:", error);
        res.status(500).send({ message: "Server error" });
    }
});

    }
    finally {

    }
}









async function startServer() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        await run();

        app.listen(5000, () => {
            console.log("Backend running on port 5000");
        });
    } catch (error) {
        console.error("Server startup failed:", error);
    }
}

startServer();