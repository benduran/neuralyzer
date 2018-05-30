using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using FlatBuffers;

namespace Neuralyzer.Core
{
  public static class Extensions
  {
    private static Action<Transport.FlatBuffers.StateUpdate> finalAction;
    private static Action<Transport.FlatBuffers.StateUpdate> sceneChangeAction;
    private static Coroutine delayedCoroutine;
    private static Coroutine sceneChangeCoroutine;
    private static WaitForSeconds delay = new WaitForSeconds(0.75f);

    public static void Debounce(this Transport.FlatBuffers.StateUpdate update,MonoBehaviour caller, Action<Transport.FlatBuffers.StateUpdate> toDo, bool isSceneChangeAction)
    {
      if (isSceneChangeAction)
      {
        if (sceneChangeCoroutine != null)
        {
          caller.StopCoroutine(sceneChangeCoroutine);
        }
        sceneChangeAction = toDo;
        delayedCoroutine = caller.StartCoroutine(delayer(update,sceneChangeAction)); 
      }
      else
      {
        if (delayedCoroutine != null)
        {
          caller.StopCoroutine(delayedCoroutine);
        }
        finalAction = toDo;
        delayedCoroutine = caller.StartCoroutine(delayer(update, finalAction));
      }
    }

    private static IEnumerator delayer(Transport.FlatBuffers.StateUpdate passedUpdate, Action<Transport.FlatBuffers.StateUpdate> action)
    {
      yield return delay;
      if(action != null)
        action.Invoke(passedUpdate);
    }

    //public static Offset<Transport.FlatBuffers.IntProperties> getOffset(
    //  this Dictionary<string, int> d)
    //{
    //  var builder
    //}

    public static Vector3 ToUnityVector(this Transport.FlatBuffers.Vector3 input)
    {
      return new Vector3(input.X,input.Y,input.Z);
    }
  }
}
