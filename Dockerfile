# Use official Node.js LTS image
FROM node:18

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and install dependencies first
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose the port for the API
EXPOSE 3001

# Set the correct command to start the server
CMD ["node", "whatsapp-server.js"]
