using FlatBuffers;

namespace Assets.Neuralyzer.Scripts.Neuralyzer.Transport
{
  interface IBufferable<T> where T : struct 
  {
    Offset<T> ToBuffer(FlatBufferBuilder builder) ;
  }
}
