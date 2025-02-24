# Use official Node.js LTS image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app files
COPY . .

# Expose the port for the Express API
EXPOSE 3001

# Run the WhatsApp bot server
CMD ["node", "whatsapp-server.js"]
