CREATE DATABASE IF NOT EXISTS `hesabchin`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `hesabchin`;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `customer_ledger`;
DROP TABLE IF EXISTS `checks`;
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `order_discount_steps`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `van_inventory`;
DROP TABLE IF EXISTS `user_products`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `customers`;
DROP TABLE IF EXISTS `invoice_settings`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `users` (
  `id` VARCHAR(36) NOT NULL,
  `firstName` VARCHAR(191) NOT NULL,
  `lastName` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` ENUM('VISITOR','ADMIN') NOT NULL DEFAULT 'VISITOR',
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `users_phone_key` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NULL,
  `baseUnitPrice` DECIMAL(12,2) NOT NULL,
  `unitsPerCartonDefault` INT NOT NULL,
  `isGlobal` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdById` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `products_createdById_idx` (`createdById`),

  CONSTRAINT `products_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_products` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `productId` VARCHAR(36) NOT NULL,
  `customCartonPrice` DECIMAL(12,2) NULL,
  `customUnitPrice` DECIMAL(12,2) NULL,
  `customUnitsPerCarton` INT NULL,
  `isActiveForUser` BOOLEAN NOT NULL DEFAULT TRUE,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `user_products_userId_productId_key` (`userId`, `productId`),
  KEY `user_products_productId_idx` (`productId`),

  CONSTRAINT `user_products_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `user_products_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customers` (
  `id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `address` TEXT NULL,
  `phone` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `assignedVisitorId` VARCHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `customers_assignedVisitorId_idx` (`assignedVisitorId`),

  CONSTRAINT `customers_assignedVisitorId_fkey`
    FOREIGN KEY (`assignedVisitorId`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `van_inventory` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `productId` VARCHAR(36) NOT NULL,
  `quantityCartons` INT NOT NULL DEFAULT 0,
  `quantityUnits` INT NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `van_inventory_userId_productId_key` (`userId`, `productId`),
  KEY `van_inventory_productId_idx` (`productId`),

  CONSTRAINT `van_inventory_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `van_inventory_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` VARCHAR(36) NOT NULL,
  `localUuid` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(36) NOT NULL,
  `visitorId` VARCHAR(36) NOT NULL,
  `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` ENUM('DRAFT','CONFIRMED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `subtotalAmount` DECIMAL(12,2) NOT NULL,
  `totalDiscountAmount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `finalAmount` DECIMAL(12,2) NOT NULL,
  `isSynced` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `orders_localUuid_key` (`localUuid`),
  KEY `orders_customerId_idx` (`customerId`),
  KEY `orders_visitorId_idx` (`visitorId`),

  CONSTRAINT `orders_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT `orders_visitorId_fkey`
    FOREIGN KEY (`visitorId`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` VARCHAR(36) NOT NULL,
  `orderId` VARCHAR(36) NOT NULL,
  `productId` VARCHAR(36) NOT NULL,
  `cartonCount` INT NOT NULL DEFAULT 0,
  `unitCount` INT NOT NULL DEFAULT 0,
  `unitPriceSnapshot` DECIMAL(12,2) NOT NULL,
  `cartonPriceSnapshot` DECIMAL(12,2) NOT NULL,
  `lineTotal` DECIMAL(12,2) NOT NULL,

  PRIMARY KEY (`id`),
  KEY `order_items_orderId_idx` (`orderId`),
  KEY `order_items_productId_idx` (`productId`),

  CONSTRAINT `order_items_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `order_items_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_discount_steps` (
  `id` VARCHAR(36) NOT NULL,
  `orderId` VARCHAR(36) NOT NULL,
  `stepOrder` INT NOT NULL,
  `percent` DECIMAL(5,2) NOT NULL,
  `amountBeforeStep` DECIMAL(12,2) NOT NULL,
  `amountAfterStep` DECIMAL(12,2) NOT NULL,

  PRIMARY KEY (`id`),
  KEY `order_discount_steps_orderId_idx` (`orderId`),

  CONSTRAINT `order_discount_steps_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `id` VARCHAR(36) NOT NULL,
  `orderId` VARCHAR(36) NOT NULL,
  `method` ENUM('CASH','CARD','CHECK','CREDIT') NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `payments_orderId_idx` (`orderId`),

  CONSTRAINT `payments_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `checks` (
  `id` VARCHAR(36) NOT NULL,
  `paymentId` VARCHAR(36) NOT NULL,
  `checkNumber` VARCHAR(191) NOT NULL,
  `bankName` VARCHAR(191) NULL,
  `dueDate` DATETIME(3) NOT NULL,
  `status` ENUM('PENDING','PASSED','BOUNCED') NOT NULL DEFAULT 'PENDING',
  `statusUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `checks_paymentId_key` (`paymentId`),

  CONSTRAINT `checks_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `payments` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_ledger` (
  `id` VARCHAR(36) NOT NULL,
  `customerId` VARCHAR(36) NOT NULL,
  `type` ENUM('ORDER_DEBIT','PAYMENT_CREDIT','ADJUSTMENT') NOT NULL,
  `relatedOrderId` VARCHAR(36) NULL,
  `relatedPaymentId` VARCHAR(36) NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `balanceAfter` DECIMAL(12,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `customer_ledger_customerId_idx` (`customerId`),
  KEY `customer_ledger_relatedOrderId_idx` (`relatedOrderId`),
  KEY `customer_ledger_relatedPaymentId_idx` (`relatedPaymentId`),

  CONSTRAINT `customer_ledger_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `customers` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT `customer_ledger_relatedOrderId_fkey`
    FOREIGN KEY (`relatedOrderId`) REFERENCES `orders` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT `customer_ledger_relatedPaymentId_fkey`
    FOREIGN KEY (`relatedPaymentId`) REFERENCES `payments` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invoice_settings` (
  `id` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NULL,
  `showDiscountBreakdown` BOOLEAN NOT NULL DEFAULT TRUE,
  `showVanInventoryRef` BOOLEAN NOT NULL DEFAULT FALSE,
  `baleNotifyCustomer` BOOLEAN NOT NULL DEFAULT TRUE,
  `baleNotifyVisitor` BOOLEAN NOT NULL DEFAULT TRUE,
  `baleIncludeItems` BOOLEAN NOT NULL DEFAULT TRUE,
  `baleIncludeDebt` BOOLEAN NOT NULL DEFAULT TRUE,
  `isDefault` BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY (`id`),
  KEY `invoice_settings_userId_idx` (`userId`),

  CONSTRAINT `invoice_settings_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
