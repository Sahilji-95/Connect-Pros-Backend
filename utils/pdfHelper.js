import PDFDocument from "pdfkit";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const convertUserDataTOPDF = async (userData) => {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: 42,
      bottom: 55,
      left: 48,
      right: 48,
    },
    bufferPages: true,
    autoFirstPage: true,
  });

  const outputPath = `${crypto.randomBytes(16).toString("hex")}.pdf`;
  const uploadDir = path.resolve("uploads");

  fs.mkdirSync(uploadDir, { recursive: true });

  const filePath = path.join(uploadDir, outputPath);
  const stream = fs.createWriteStream(filePath);

  const user = userData.userId || {};

  const C = {
    navy: "#172B4D",
    blue: "#3568B8",
    text: "#273449",
    muted: "#65748B",
    line: "#DCE3EC",
    pale: "#F3F6FA",
    white: "#FFFFFF",
  };

  const PAGE_WIDTH = doc.page.width;
  const PAGE_HEIGHT = doc.page.height;
  const LEFT = 48;
  const RIGHT = 48;
  const WIDTH = PAGE_WIDTH - LEFT - RIGHT;
  const CONTENT_BOTTOM = PAGE_HEIGHT - 62;

  let pageNumberFont = "Helvetica";

  doc.pipe(stream);

  const ensureSpace = (height = 55) => {
    if (doc.y + height > CONTENT_BOTTOM) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  const sectionTitle = (title) => {
    ensureSpace(48);

    doc.moveDown(0.65);

    const y = doc.y;

    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor(C.navy)
      .text(title, LEFT, y, {
        width: WIDTH,
        lineBreak: false,
      });

    const lineY = doc.y + 7;

    doc
      .moveTo(LEFT, lineY)
      .lineTo(PAGE_WIDTH - RIGHT, lineY)
      .strokeColor(C.line)
      .lineWidth(1)
      .stroke();

    doc.y = lineY + 13;
  };

  const wrappedText = (text, options = {}) => {
    const {
      x = LEFT,
      width = WIDTH,
      font = "Helvetica",
      size = 10,
      color = C.text,
      lineGap = 3,
    } = options;

    const value = String(text || "").trim();

    if (!value) return;

    doc.font(font).fontSize(size);

    const textOptions = {
      width,
      lineGap,
      paragraphGap: 3,
    };

    const height = doc.heightOfString(value, textOptions);
    ensureSpace(Math.min(height, 90));

    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(value, x, doc.y, textOptions);
  };

  const timelineItem = (title, subtitle, detail = "") => {
    const textX = LEFT + 22;
    const textWidth = WIDTH - 25;
    const titleText = String(title || "Not specified");
    const subtitleText = String(subtitle || "");
    const detailText = String(detail || "");

    const titleOptions = {
      width: textWidth,
      lineGap: 2,
    };

    const bodyOptions = {
      width: textWidth,
      lineGap: 2,
    };

    doc.font("Helvetica-Bold").fontSize(11);
    const titleHeight = doc.heightOfString(titleText, titleOptions);

    doc.font("Helvetica").fontSize(10);
    const subtitleHeight = subtitleText
      ? doc.heightOfString(subtitleText, bodyOptions)
      : 0;

    doc.font("Helvetica").fontSize(9);
    const detailHeight = detailText
      ? doc.heightOfString(detailText, bodyOptions)
      : 0;

    const entryHeight = titleHeight + subtitleHeight + detailHeight + 17;

    ensureSpace(entryHeight);

    const startY = doc.y;

    doc
      .circle(LEFT + 6, startY + 6, 3.5)
      .fillColor(C.blue)
      .fill();

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(C.navy)
      .text(titleText, textX, startY, titleOptions);

    if (subtitleText) {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(C.text)
        .text(subtitleText, textX, doc.y + 3, bodyOptions);
    }

    if (detailText) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(C.muted)
        .text(detailText, textX, doc.y + 3, bodyOptions);
    }

    doc.y += 12;
  };

  try {
    const photoSize = 92;
    const photoX = LEFT;
    const photoY = 48;

    let photoAdded = false;

    if (user.profilePicture) {
      try {
        const imageURL = new URL(user.profilePicture);

        if (
          imageURL.protocol === "https:" &&
          imageURL.hostname === "res.cloudinary.com"
        ) {
          const response = await fetch(user.profilePicture, {
            signal: AbortSignal.timeout(10000),
          });

          const type = response.headers.get("content-type");

          if (response.ok && type?.startsWith("image/")) {
            const buffer = Buffer.from(await response.arrayBuffer());

            if (buffer.length <= 5 * 1024 * 1024) {
              doc.image(buffer, photoX, photoY, {
                fit: [photoSize, photoSize],
                align: "center",
                valign: "center",
              });

              photoAdded = true;
            }
          }
        }
      } catch (error) {
        console.error("Profile image could not be loaded:", error.message);
      }
    }

    const headerX = photoAdded ? LEFT + photoSize + 24 : LEFT;
    const headerWidth = PAGE_WIDTH - RIGHT - headerX;

    doc
      .font("Helvetica-Bold")
      .fontSize(26)
      .fillColor(C.navy)
      .text(user.name || "Your Name", headerX, photoY + 3, {
        width: headerWidth,
      });

    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor(C.text)
      .text(`@${user.username || ""}`, {
        width: headerWidth,
      });

    if (user.email) {
      doc.text(user.email, {
        width: headerWidth,
      });
    }

    doc.y = Math.max(doc.y, photoY + photoSize) + 20;

    doc
      .moveTo(LEFT, doc.y)
      .lineTo(PAGE_WIDTH - RIGHT, doc.y)
      .strokeColor(C.line)
      .lineWidth(1)
      .stroke();

    doc.y += 4;

    sectionTitle("About Me");

    wrappedText(userData.bio || "No bio added yet.", {
      font: "Helvetica",
      size: 10,
      color: C.muted,
      lineGap: 4,
    });

    sectionTitle("Current Position");

    wrappedText(userData.currentPost || "Not specified", {
      font: "Helvetica",
      size: 11,
      color: C.text,
      lineGap: 3,
    });

    sectionTitle("Past Work");

    const workItems = userData.pastWork || [];

    if (workItems.length === 0) {
      wrappedText("No past work details added yet.", {
        size: 10,
        color: C.muted,
      });
    } else {
      workItems.forEach((work) => {
        timelineItem(
          work.pastWork || "Organization",
          work.position || "Role not specified",
          work.years || "",
        );
      });
    }

    sectionTitle("Education");

    const educationItems = userData.education || [];

    if (educationItems.length === 0) {
      wrappedText("No education details added yet.", {
        size: 10,
        color: C.muted,
      });
    } else {
      educationItems.forEach((education) => {
        const subtitle = [education.degree, education.fieldOfStudy]
          .filter(Boolean)
          .join(" | ");

        timelineItem(
          education.school || "Institution",
          subtitle || "Degree not specified",
        );
      });
    }

    const pages = doc.bufferedPageRange();

    for (let index = pages.start; index < pages.start + pages.count; index++) {
      doc.switchToPage(index);

      const footerY = PAGE_HEIGHT - 30;

      doc
        .moveTo(LEFT, footerY - 8)
        .lineTo(PAGE_WIDTH - RIGHT, footerY - 8)
        .strokeColor(C.line)
        .lineWidth(0.6)
        .stroke();

      doc
        .font(pageNumberFont)
        .fontSize(8)
        .fillColor(C.muted)
        .text("Professional Profile", LEFT, footerY, {
          width: 200,
          lineBreak: false,
        });

      doc.text(
        `Page ${index + 1} of ${pages.count}`,
        PAGE_WIDTH - RIGHT - 100,
        footerY,
        {
          width: 100,
          align: "right",
          lineBreak: false,
        },
      );
    }

    doc.end();

    await new Promise((resolve, reject) => {
      stream.once("finish", resolve);
      stream.once("error", reject);
      doc.once("error", reject);
    });

    return outputPath;
  } catch (error) {
    doc.destroy();
    stream.destroy();
    throw error;
  }
};

export default convertUserDataTOPDF;
