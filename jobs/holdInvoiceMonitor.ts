import { Order } from '../models';
import { checkHoldInvoiceExpiration } from '../ln/hold_invoice';
import { logger } from '../logger';
import { Document, ObjectId } from 'mongoose';

const CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

interface IOrder {
    // Existing properties of Order, and adding hold_invoice_hash
    hold_invoice_hash?: string;
    _id: ObjectId;
    // Other properties...
  }
  
  // Now, for the monitorHoldInvoices function:
  const monitorHoldInvoices = async () => {
    try {
      // Find all orders with PAID_HOLD_INVOICE status
      const orders: (IOrder & Document)[] = await Order.find({ status: 'PAID_HOLD_INVOICE' });
      
      for (const order of orders) {
        if (order.hold_invoice_hash) {
          await checkHoldInvoiceExpiration({
            hash: order.hold_invoice_hash,
            orderId: order._id
          });
        }
      }
    } catch (error) {
      logger.error('Error monitoring hold invoices:', error);
    }
  };
  
  // Start monitoring process
  const startMonitoring = () => {
    setInterval(monitorHoldInvoices, CHECK_INTERVAL);
    logger.info('Hold invoice monitoring started');
  };
  
  export { startMonitoring };