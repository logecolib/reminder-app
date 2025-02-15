/* eslint-disable */
import { KeystoneContext } from '@keystone-next/types';
import { errorMonitor } from 'nodemailer/lib/xoauth2';
import {
  CartItemCreateInput,
  OrderCreateInput,
} from '../.keystone/schema-types';
import stripeConfig from '../lib/stripe';
import { Session } from '../types';

const graphql = String.raw;
interface Arguments {
  token: string;
}

async function checkout(
  root: any,
  { token }: Arguments,
  context: KeystoneContext
): Promise<OrderCreateInput> {
  // 1. Make sure they are signed in
  const userId = context.session.itemId;
  if (!userId) {
    throw new Error('Sorry! You musdt be signed in to create new order!');
  }
  // 1.5 query the current user
  const user = await context.lists.User.findOne({
    where: { id: userId },
    resolveFields: graphql`
      id
      name
      email
      cart {
        id
        quantity
        membership {
          name
          price
          description
          id
        }
      }
    `,
  });
  console.dir(user, { depth: null });
  // 2. Calculate the total price
  const cartItems = user.cart.filter((cartItem) => cartItem.membership);
  const amount = cartItems.reduce(function (
    tally: number,
    cartItem: CartItemCreateInput
  ) {
    return tally + cartItem.quantity * cartItem.membership.price;
  },
  0);
  console.log(amount);
  // 3. create the payment with stripe library
  const charge = await stripeConfig.paymentIntents
    .create({
      amount,
      currency: 'USD',
      confirm: true,
      payment_method: token,
    })
    .catch((err) => {
      console.log(err);
      throw new Error(err.message);
    });
  console.log(charge);
  // 4. upgrade user membership in database
  context.lists.User.updateOne({
    id: userId,
    data: {
      membership: { connect: { id: user.cart[0].membership.id } },
    },
  });
  // 5. Convert the cartItems to OrderItems
  const orderItems = cartItems.map((cartItem) => {
    const orderItem = {
      name: cartItem.membership.name,
      description: cartItem.membership.description,
      price: cartItem.membership.price,
      quantity: cartItem.quantity,
    };
    return orderItem;
  });
  // 5. Create the order and return it
  const order = await context.lists.Order.createOne({
    data: {
      total: charge.amount,
      charge: charge.id,
      items: { create: orderItems },
      user: { connect: { id: userId } },
    },
  });
  // 6. clean up any old cart items
  const cartItemIds = user.cart.map((cartItem) => cartItem.id);
  await context.lists.CartItem.deleteMany({
    ids: cartItemIds,
  });
  return order;
}

export default checkout;
