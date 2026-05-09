import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const RAILWAY_SECRET = process.env.RAILWAY_SECRET; // optional shared secret

if (!SLACK_WEBHOOK_URL) {
  console.error("Missing SLACK_WEBHOOK_URL env var");
  process.exit(1);
}

// Helper: decide if event is a failure/crash
function isFailureEvent(body: any): boolean {
  const candidates: string[] = [];

  if (typeof body.status === "string") candidates.push(body.status);
  if (typeof body.state === "string") candidates.push(body.state);
  if (typeof body.deployment?.status === "string")
    candidates.push(body.deployment.status);
  if (typeof body.deployment?.state === "string")
    candidates.push(body.deployment.state);

  const statusCombined = candidates.join(" ").toLowerCase();

  if (!statusCombined) return false;

  return (
    statusCombined.includes("fail") ||
    statusCombined.includes("error") ||
    statusCombined.includes("crash")
  );
}

app.post("/railway-hook", async (req, res) => {
  try {
    // Optional simple auth using shared secret
    if (RAILWAY_SECRET) {
      const incomingSecret =
        (req.headers["x-railway-secret"] as string | undefined) ||
        (req.query.secret as string | undefined);
      if (!incomingSecret || incomingSecret !== RAILWAY_SECRET) {
        console.warn("Invalid secret on incoming webhook");
        return res.status(401).send("Unauthorized");
      }
    }

    const body = req.body;

    // If not a failure event, just ignore
    if (!isFailureEvent(body)) {
      return res.status(200).send("Ignored non-failure event");
    }

    // Try to extract useful fields; adjust once you see real payload
    const projectName =
      body.project?.name || body.project || "Unknown project";
    const serviceName =
      body.service?.name || body.service || "Unknown service";
    const envName =
      body.environment?.name ||
      body.environment ||
      body.env ||
      "Unknown env";

    const deploymentId =
      body.deployment?.id || body.id || "Unknown deployment";
    const status =
      body.deployment?.status || body.status || body.state || "unknown";

    const deploymentUrl =
      body.deployment?.url ||
      body.url ||
      ""; // if Railway provides a link; otherwise leave blank

    const textLines = [
      "❌ Railway deployment FAILED",
      "",
      `Project: ${projectName}`,
      `Service: ${serviceName}`,
      `Environment: ${envName}`,
      `Status: ${status}`,
      `Deployment ID: ${deploymentId}`
    ];

    if (deploymentUrl) {
      textLines.push(`Link: ${deploymentUrl}`);
    }

    const text = textLines.join("\n");

    const slackResp = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!slackResp.ok) {
      const errText = await slackResp.text();
      console.error("Slack webhook error:", slackResp.status, errText);
      return res.status(500).send("Failed to send to Slack");
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Error handling Railway webhook:", err);
    res.status(500).send("Internal error");
  }
});

app.get("/", (_req, res) => {
  res.send("Railway → Slack webhook is running");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
