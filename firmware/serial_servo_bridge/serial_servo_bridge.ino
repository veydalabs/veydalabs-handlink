#include <Servo.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

static const byte NUM_SERVOS = 5;
static const byte SERVO_PINS[NUM_SERVOS] = {3, 5, 6, 9, 10};

static const int SERVO_MIN_ANGLE = 15;
static const int SERVO_MAX_ANGLE = 165;
static const int SERVO_NEUTRAL_ANGLE = 90;

static const int STEP_DEGREES = 5;
static const unsigned long PRINT_INTERVAL_MS = 250;

Servo servos[NUM_SERVOS];
int angles[NUM_SERVOS] = {
  SERVO_NEUTRAL_ANGLE, SERVO_NEUTRAL_ANGLE, SERVO_NEUTRAL_ANGLE, SERVO_NEUTRAL_ANGLE, SERVO_NEUTRAL_ANGLE
};
bool servoAttached[NUM_SERVOS] = {false, false, false, false, false};
bool hasPose = false;

char rxBuffer[80];
byte rxIndex = 0;
unsigned long lastPrintMs = 0;

int clampServoAngle(int angle) {
  if (angle < SERVO_MIN_ANGLE) return SERVO_MIN_ANGLE;
  if (angle > SERVO_MAX_ANGLE) return SERVO_MAX_ANGLE;
  return angle;
}

void writeServoAngle(byte index, int targetAngle) {
  int bounded = clampServoAngle(targetAngle);
  if (!servoAttached[index]) {
    servos[index].attach(SERVO_PINS[index]);
    servoAttached[index] = true;
    delay(5);
  }
  angles[index] = bounded;
  servos[index].write(bounded);
  hasPose = true;
}

void printAngles() {
  if (!hasPose) {
    Serial.println("Angles: no pose sent yet");
    return;
  }

  Serial.print("Angles: ");
  for (byte i = 0; i < NUM_SERVOS; i++) {
    Serial.print("S");
    Serial.print(i + 1);
    Serial.print("=");
    Serial.print(angles[i]);
    if (i < NUM_SERVOS - 1) Serial.print("  ");
  }
  Serial.println();
}

void printHelp() {
  Serial.println("Serial Servo Bridge");
  Serial.print("Angle limiter: ");
  Serial.print(SERVO_MIN_ANGLE);
  Serial.print("..");
  Serial.println(SERVO_MAX_ANGLE);
  Serial.println("Commands:");
  Serial.println("  A a1 a2 a3 a4 a5 -> set absolute angles");
  Serial.println("  O -> all to minimum angle");
  Serial.println("  C -> all to maximum angle");
  Serial.println("  N -> all to neutral angle");
  Serial.println("  P -> print current angles");
  Serial.println("  H -> show help");
  Serial.println("Single-key manual step (5 deg):");
  Serial.println("  q/a S1 +/-    w/s S2 +/-    e/d S3 +/-");
  Serial.println("  r/f S4 +/-    t/g S5 +/-");
}

void applyUniformPose(int angle) {
  for (byte i = 0; i < NUM_SERVOS; i++) writeServoAngle(i, angle);
}

void stepServo(byte index, int delta) {
  writeServoAngle(index, angles[index] + delta);
  printAngles();
}

void handleSingleKey(char c) {
  char key = (char)tolower((unsigned char)c);
  switch (key) {
    case 'q': stepServo(0, +STEP_DEGREES); break;
    case 'a': stepServo(0, -STEP_DEGREES); break;
    case 'w': stepServo(1, +STEP_DEGREES); break;
    case 's': stepServo(1, -STEP_DEGREES); break;
    case 'e': stepServo(2, +STEP_DEGREES); break;
    case 'd': stepServo(2, -STEP_DEGREES); break;
    case 'r': stepServo(3, +STEP_DEGREES); break;
    case 'f': stepServo(3, -STEP_DEGREES); break;
    case 't': stepServo(4, +STEP_DEGREES); break;
    case 'g': stepServo(4, -STEP_DEGREES); break;
    default:
      break;
  }
}

void handleLine(char* line) {
  if (line[0] == '\0') return;

  if (line[1] == '\0') {
    char key = (char)toupper((unsigned char)line[0]);
    if (key == 'O') {
      applyUniformPose(SERVO_MIN_ANGLE);
      printAngles();
      return;
    }
    if (key == 'C') {
      applyUniformPose(SERVO_MAX_ANGLE);
      printAngles();
      return;
    }
    if (key == 'N') {
      applyUniformPose(SERVO_NEUTRAL_ANGLE);
      printAngles();
      return;
    }
    if (key == 'P') {
      printAngles();
      return;
    }
    if (key == 'H' || key == '?') {
      printHelp();
      return;
    }
    handleSingleKey(line[0]);
    return;
  }

  if (toupper((unsigned char)line[0]) != 'A') {
    Serial.print("Unknown command: ");
    Serial.println(line);
    return;
  }

  int values[NUM_SERVOS];
  byte parsed = 0;
  char* token = strtok(line + 1, " ,\t");
  while (token != NULL && parsed < NUM_SERVOS) {
    values[parsed++] = atoi(token);
    token = strtok(NULL, " ,\t");
  }

  if (parsed != NUM_SERVOS) {
    Serial.println("ERR expected 5 angles");
    return;
  }

  for (byte i = 0; i < NUM_SERVOS; i++) writeServoAngle(i, values[i]);

  unsigned long now = millis();
  if (now - lastPrintMs >= PRINT_INTERVAL_MS) {
    printAngles();
    lastPrintMs = now;
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  printHelp();
  Serial.println("Servos idle until first command.");
  printAngles();
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      rxBuffer[rxIndex] = '\0';
      handleLine(rxBuffer);
      rxIndex = 0;
      continue;
    }

    if (rxIndex < sizeof(rxBuffer) - 1) {
      rxBuffer[rxIndex++] = c;
    } else {
      rxIndex = 0;
      Serial.println("ERR command too long");
    }
  }
}
