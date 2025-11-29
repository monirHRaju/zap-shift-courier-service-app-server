const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
//stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;
const crypto = require("crypto");

// firebase admin sdk
const admin = require("firebase-admin");

const serviceAccount = require("./fbServiceAccount.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    // 1st verify: auth.verifyToken()
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    console.log({ "decoded in the token": decoded });

    // to 2nd step verify use decoded email
    //set decoded_email and send to function as req
    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.w1zimwj.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("zap_shift_db");
    const userCollection = db.collection("users");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const ridersCollection = db.collection("riders");

    // admin verify middleware
    const verifyAdmin = async(req, res, next) => {
      // get email from verifyFBToken as it is hit before verifyAdmin
      const email = req.decoded_email
      const query = {email}
      const user = await userCollection.findOne(query)
      console.log(user)
      if(!user || user.role !== "admin"){
        return res.status(403).send({message: "forbidden access"})
      }

      next()
    }

    // user related api
    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();

      res.send(result);
    });
    app.get("/users/:id", () => {});


    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExist = await userCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "User already exist" });
      }
      const result = await userCollection.insertOne(user);

      res.send(result);
    });

    // update user role
    // app.patch("/users/:id/role", async (req, res) => {
    //   const id = req.params.id;
    //   const roleInfo = req.body;
    //   const query = { _id: new ObjectId(id) };
    //   const updatedRole = {
    //     $set: {
    //       role: roleInfo.role,
    //     },
    //   };

    //   const result = await userCollection.updateOne(query, updatedRole);
    //   res.send(result);
    // });

    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updatedDoc)
            res.send(result);
        })




    //rider related api
    app.get("/riders", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = ridersCollection.find(query).sort({ createdAt: 1 });
      const result = await cursor.toArray();

      res.send(result);
    });

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    // update rider status
    app.patch("/riders/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
        },
      };
      const result = await ridersCollection.updateOne(query, updatedDoc);

      // add/update user role after approve a rider
      if (status === "approved") {
        const email = req.body.email;
        const query = { email: email };

        const userUpdate = {
          $set: {
            role: "rider",
          },
        };

        const userResponse = await userCollection.updateOne(query, userUpdate);
      }
      res.send(result);
    });

    // parcel api

    //get all parcels
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      // /parcels?email=''
      if (email) {
        query.senderEmail = email;
      }

      const cursor = parcelsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get a single parcel
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await parcelsCollection.findOne(query);

      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();

      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);

      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    // update session data and retrieve
    // in my function tracking id is missing
    // app.patch("/payment-success", async (req, res) => {
    //   const sessionId = req.query.session_id;

    //   const session = await stripe.checkout.sessions.retrieve(sessionId);

    //   console.log('session retrieve', session);
    //   const trackingId = generateTrackingId()

    //   if (session.payment_status === 'paid') {
    //     const id = session.metadata.parcelId;
    //     const query = { _id: new ObjectId(id) };

    //     const update = {
    //       $set: {
    //         paymentStatus: "paid",
    //         trackingId: trackingId
    //       },
    //     };
    //     const result = await parcelsCollection.updateOne(query, update);
    //     console.log("update paid result", result);

    //     const payment = {
    //       amount: session.amount_total / 100,
    //       currency: session.currency,
    //       customerEmail: session.customer_email,
    //       parcelId: session.metadata.parcelId,
    //       parcelName: session.metadata.parcelName,
    //       transactionId: session.payment_intent,
    //       paymentStatus: session.payment_status,
    //       paidAd: new Date(),
    //       trackingId
    //     };

    //     if (session.payment_status === "paid") {
    //       const resultPayment = await paymentCollection.insertOne(payment);

    //       res.send({
    //         success: true,
    //         modifyParcel: result,
    //         transactionId: session.payment_intent,
    //         paymentInfo: resultPayment,
    //       });
    //     }
    //   }

    //   res.send({ success: false });
    // });

    // copy from ph

    //payment success copied from ph
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      console.log("session retrieve", session);
      const trackingId = generateTrackingId();

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);

      if (paymentExist) {
        return res.send({
          message: "already exist",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };

        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          console.log("tracking id is", trackingId);
          res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }

      res.send({ success: false });
    });

    //payment related api, get all payment data
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log('headers', req.headers);

      if (email) {
        query.customerEmail = email;

        //check email address

        // if false, then logout
        if (email !== req.decoded_email) {
          // if request for others data, logout immediately
          return res.status(403).send({ message: "forbidden access" });
        }
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("zap is shifting shifting!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
