import { Resend } from "resend";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const APP_NAME = process.env.APP_NAME || "ConnectPros";
const BRAND_COLOR = "#6366f1";

export const generateEmailOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const hashEmailOtp = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

const buildVerifyEmailHtml = ({ otp, expiryMinutes }) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light only" />
    <title>Verify your email</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f5f7;">
    <!-- Preheader (inbox preview text) -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      Your ${APP_NAME} verification code is ${otp}. It expires in ${expiryMinutes} minutes.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="max-width:480px; background-color:#ffffff; border-radius:16px; overflow:hidden; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">

            <!-- Header -->
            <tr>
              <td align="center" style="background-color:${BRAND_COLOR}; padding:28px 24px;">
                <div style="font-size:22px; font-weight:700; color:#ffffff; letter-spacing:0.5px;">
                  ${APP_NAME}
                </div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:32px 28px 8px 28px; color:#24292f;">
                <h2 style="margin:0 0 12px 0; font-size:20px; color:#111827;">
                  Verify your email address
                </h2>
                <p style="margin:0; font-size:15px; line-height:1.6; color:#4b5563;">
                  Welcome to ${APP_NAME}! Thanks for signing up. Enter the code below to verify your email and activate your account.
                </p>
              </td>
            </tr>

            <!-- OTP box -->
            <tr>
              <td style="padding:20px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                  style="background-color:#eef2ff; border:1px dashed ${BRAND_COLOR}; border-radius:12px;">
                  <tr>
                    <td align="center" style="padding:24px 12px;">
                      <div style="font-size:11px; font-weight:600; letter-spacing:2px; color:#6b7280; text-transform:uppercase;">
                        Your verification code
                      </div>
                      <div style="font-size:38px; font-weight:700; letter-spacing:10px; color:${BRAND_COLOR}; margin:12px 0 8px 0; font-family:'Courier New', monospace;">
                        ${otp}
                      </div>
                      <div style="font-size:13px; color:#6b7280;">
                        Expires in <strong>${expiryMinutes} minutes</strong>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Security note -->
            <tr>
              <td style="padding:0 28px 28px 28px;">
                <p style="margin:0 0 12px 0; font-size:13px; line-height:1.6; color:#6b7280;">
                  🔒 For your security, never share this code with anyone. ${APP_NAME} will never ask for it.
                </p>
                <p style="margin:0; font-size:13px; line-height:1.6; color:#6b7280;">
                  If you didn't create an account, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="background-color:#f9fafb; padding:16px 24px; border-top:1px solid #e5e7eb;">
                <p style="margin:0; font-size:12px; color:#9ca3af;">
                  © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const buildVerifyEmailText = ({ otp, expiryMinutes }) =>
  `Verify your ${APP_NAME} email address

Welcome to ${APP_NAME}! Thanks for signing up.

Your verification code: ${otp}
This code expires in ${expiryMinutes} minutes.

Never share this code with anyone.
If you didn't create an account, you can safely ignore this email.`;

export const sendEmailOtp = async (email, otp, expiryMinutes = 5) => {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `${otp} is your ${APP_NAME} verification code`,
    html: buildVerifyEmailHtml({ otp, expiryMinutes }),
    text: buildVerifyEmailText({ otp, expiryMinutes }),
  });

  if (error) {
    throw new Error(error.message || "Failed to send verification email");
  }

  return data;
};
